import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isWallMounted, type ProductDto, type SceneAnchor, type SceneDto } from '@airoom/shared';
import {
  FurnitureARView,
  type ARErrorEvent,
  type ARPose,
  type FurnitureARViewRef,
  type TrackingState,
} from '../modules/furniture-ar';
import { ApiError, createScene, getProducts, getScene, updateScene } from '../src/api/client';
import { blockedMessage, canPlace, errorCodeOf, errorMessage, getGuidance, surfaceFor } from '../src/ar/guidance';
import { fitReference, referenceFromItem, toSceneItems, toWorldPose, type AnchorMatch } from '../src/ar/layout';
import { ProductPickerSheet } from '../src/components/ProductPickerSheet';
import { SaveSceneDialog } from '../src/components/SaveSceneDialog';
import { ShoppingListSheet } from '../src/components/ShoppingListSheet';
import { ErrorView, LoadingView } from '../src/components/StateViews';
import { colors, spacing } from '../src/components/theme';
import { useARAvailability } from '../src/hooks/useARAvailability';
import { useAsync } from '../src/hooks/useAsync';
import { newInstanceId, useSceneState } from '../src/store/scene';
import { openBuyPage } from '../src/utils/buy';
import { formatPrice } from '../src/utils/format';
import { buildShoppingList, formatTotals } from '../src/utils/shoppingList';

const TOAST_MS = 2500;
/**
 * A saved scene appears by itself once the AR view can place it: after this long with the
 * surface found (so the floor estimate has settled), and again after each miss (e.g. the
 * center of the screen is not on the floor yet).
 */
const AUTO_PLACE_DELAY_MS = 1200;
/** Misses worth retrying automatically (aim/scan related); others wait for the button. */
const AUTO_RETRY_CODES = new Set(['NO_FLOOR', 'NO_WALL', 'NOT_READY', 'PLACEMENT_BLOCKED']);
/**
 * Reopening a scene with cloud anchors: once the first item's anchor is found, the others get
 * this long to be found too; items still missing then are placed around the found ones.
 */
const RESTORE_WINDOW_MS = 4000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Saving again: an item still at its cloud anchor keeps it if it lives at least this long. */
const ANCHOR_REUSE_MIN_MS = 30 * DAY_MS;

/** One run of restoring a scene from its cloud anchors (see the effect in ARSession). */
interface RestoreRun {
  /** Found anchors, for placing the items that have none (fitReference). */
  matches: AnchorMatch[];
  /** Indexes (into the scene's available items) placed on their own anchor. */
  restored: Set<number>;
  failures: string[];
  /** Anchors still being looked for. */
  outstanding: number;
  finished: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * AR scene editor. Opened from a product (`productId`: ready to place it), from the Scenes tab
 * with a saved scene (`sceneId`: rebuilt around the first item the user aims), or empty.
 */
export default function ARScreen() {
  const { productId, sceneId } = useLocalSearchParams<{ productId?: string; sceneId?: string }>();
  // The whole catalog: for the "Add" picker and to look up the products of a saved scene.
  const catalog = useAsync((signal) => getProducts({}, signal), []);
  const saved = useAsync((signal) => (sceneId ? getScene(sceneId, signal) : Promise.resolve(null)), [sceneId]);
  const { availability, retry } = useARAvailability();

  let content: ReactElement;
  let isCamera = false;
  const loadError = catalog.status === 'error' ? catalog : saved.status === 'error' ? saved : null;
  if (loadError?.error) {
    const message =
      loadError.error instanceof ApiError && loadError.error.status === 404
        ? 'This scene no longer exists.'
        : loadError.error.message;
    content = <ErrorView message={message} onRetry={loadError.reload} />;
  } else if (!catalog.data || saved.status === 'loading' || availability.status === 'checking') {
    content = <LoadingView />;
  } else if (availability.status === 'unsupported') {
    content = (
      <BlockingMessage
        title="AR isn't available on this device"
        message="Viewing furniture in your room needs a phone with ARCore (Android) or ARKit (iPhone)."
      />
    );
  } else if (availability.status === 'permissionDenied') {
    content = (
      <BlockingMessage
        title="Camera access needed"
        message="AIRoom uses the camera to show furniture at real size in your room. Nothing is recorded or uploaded."
        actionLabel={availability.canAskAgain ? 'Allow camera' : 'Open settings'}
        onAction={availability.canAskAgain ? retry : () => Linking.openSettings()}
      />
    );
  } else {
    content = <ARSession products={catalog.data} initialProductId={productId} savedScene={saved.data ?? null} />;
    isCamera = true;
  }

  return (
    // Black behind the camera; the light app background for loading/error/message states.
    <View style={isCamera ? styles.screen : styles.messageScreen}>
      <Stack.Screen options={{ headerShown: false }} />
      {content}
    </View>
  );
}

function ARSession({
  products,
  initialProductId,
  savedScene,
}: {
  products: ProductDto[];
  initialProductId?: string;
  savedScene: SceneDto | null;
}) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const arRef = useRef<FurnitureARViewRef>(null);
  const [scene, dispatch] = useSceneState();
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const [floorCount, setFloorCount] = useState(0);
  const [wallCount, setWallCount] = useState(0);
  const [fatalError, setFatalError] = useState<ARErrorEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  /** Product about to be placed (aim + Place); null while arranging. */
  const [nextProduct, setNextProduct] = useState<ProductDto | null>(() =>
    initialProductId ? byId.get(initialProductId) ?? null : null,
  );
  /** Saved scene opened but not rebuilt yet. */
  const [pendingScene, setPendingScene] = useState<SceneDto | null>(savedScene);
  /**
   * How a pending scene comes back: `anchor` = each item at its saved spot in the room (their
   * cloud anchors are being looked for); `aim` = around where the screen center points.
   */
  const [restoreMode, setRestoreMode] = useState<'anchor' | 'aim'>(() => (hasLiveAnchors(savedScene) ? 'anchor' : 'aim'));
  const restoreRun = useRef<RestoreRun | null>(null);
  /** Cloud anchors found so far while restoring (for the hint). */
  const [found, setFound] = useState(0);
  /** Expiry of every cloud anchor known in this session, by id (to reuse them when saving again). */
  const knownAnchors = useRef(
    new Map((savedScene?.items ?? []).flatMap((i) => (i.anchor ? [[i.anchor.cloudAnchorId, i.anchor.expiresAt] as const] : []))),
  );
  /** The scene in the API this session saves to (null until first saved). */
  const [savedInfo, setSavedInfo] = useState<{ id: string; name: string } | null>(
    savedScene ? { id: savedScene.id, name: savedScene.name } : null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [saveProgress, setSaveProgress] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  /** Changed since the last save (placed, removed, or touched: moves are not reported). */
  const dirty = useRef(false);
  /** Automatic scene placement in progress: its misses are retried silently, not shown. */
  const quiet = useRef(false);
  const [autoAttempt, setAutoAttempt] = useState(0);
  /** Error code of the last failed aimed placement. */
  const lastPlaceError = useRef<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    // Longer messages stay longer.
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS + message.length * 25);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  // Leaving the screen ends a restore still looking for anchors: its last pending lookups
  // (cancelled with the view) must not run `finish` on a view that no longer exists.
  useEffect(
    () => () => {
      const run = restoreRun.current;
      if (!run) return;
      run.finished = true;
      clearTimeout(run.timer);
    },
    [],
  );

  // Leaving with unsaved changes (close button, back gesture, hardware back) asks first.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (!dirty.current || scene.items.length === 0) return;
        e.preventDefault();
        Alert.alert('Leave without saving?', 'Your changes to this scene will be lost.', [
          { text: 'Stay', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
        ]);
      }),
    [navigation, scene.items.length],
  );

  // What is being placed: the chosen product, or the first available product of a saved scene.
  const pendingEntries = useMemo(
    () =>
      (pendingScene?.items ?? []).flatMap((saved) => {
        const product = byId.get(saved.productId);
        return product ? [{ saved, product }] : [];
      }),
    [pendingScene, byId],
  );
  const placingProduct = pendingScene ? pendingEntries[0]?.product ?? null : nextProduct;
  const surface = placingProduct ? surfaceFor(placingProduct.category.slug) : null;
  const selectedItem = scene.items.find((i) => i.instanceId === scene.selectedId);
  const selectedProduct = selectedItem ? byId.get(selectedItem.productId) : undefined;
  const busy = scene.placingId !== null || restoring;

  // What the scene costs. A saved scene still coming back counts whole (its list and total
  // show from the start); after that, what is placed.
  const listProductIds = useMemo(
    () => (pendingScene ? pendingScene.items : scene.items).map((i) => i.productId),
    [pendingScene, scene.items],
  );
  const shopping = useMemo(() => buildShoppingList(listProductIds, byId), [listProductIds, byId]);

  const guidanceInput = {
    surface,
    tracking,
    floorCount,
    wallCount,
    itemCount: scene.items.length,
    isPlacing: busy,
    selectedSurface: selectedProduct ? surfaceFor(selectedProduct.category.slug) : null,
  };

  const isWallProduct = useCallback(
    (id: string) => {
      const product = byId.get(id);
      return product ? isWallMounted(product.category.slug) : false;
    },
    [byId],
  );

  /**
   * Places a product where the screen center aims, or, rebuilding a saved scene, on a found
   * cloud anchor (`cloudAnchorId`) or at a world `pose`. `silent`: no message on failure.
   * Resolves to the new instance id, or null if it could not be placed.
   */
  const placeProduct = async (
    product: ProductDto,
    { pose, cloudAnchorId, silent = false }: { pose?: ARPose; cloudAnchorId?: string; silent?: boolean } = {},
  ): Promise<string | null> => {
    const ar = arRef.current;
    if (!ar) return null;
    const instanceId = newInstanceId(product.id);
    const isRestore = pose !== undefined || cloudAnchorId !== undefined;
    if (!isRestore) dispatch({ type: 'placeStarted', instanceId });
    try {
      await ar.placeItem({
        instanceId,
        productId: product.id,
        category: product.category.slug,
        glbUrl: product.model.glbUrl,
        usdzUrl: product.model.usdzUrl,
        dimensions: product.dimensions,
        ...(pose ? { pose } : {}),
        ...(cloudAnchorId ? { cloudAnchorId } : {}),
      });
      dispatch({ type: 'placeSucceeded', item: { instanceId, productId: product.id } });
      // A restored item is not a change (placeAround decides whether the restore changed anything).
      if (!isRestore) dirty.current = true;
      return instanceId;
    } catch (error) {
      if (isRestore) {
        // Reported once, by name, by placeAround; the reason goes to the log.
        console.warn(`Restoring ${product.id} failed: ${errorCodeOf(error)}`);
        return null;
      }
      dispatch({ type: 'placeFailed', instanceId });
      const code = errorCodeOf(error);
      lastPlaceError.current = code;
      // MODEL_LOAD_FAILED also arrives through onError, which shows the same toast;
      // CANCELLED means the user removed it while loading.
      if (!silent && code !== 'MODEL_LOAD_FAILED' && code !== 'CANCELLED') {
        showToast(errorMessage({ code, message: '' }, surfaceFor(product.category.slug)));
      }
      return null;
    }
  };

  const placeNext = async () => {
    if (!nextProduct) return;
    if (await placeProduct(nextProduct)) setNextProduct(null);
  };

  /**
   * Places the pending scene's items around its reference pose (at `toWorldPose`), reports
   * skipped ones and ends the restore.
   */
  const placeAround = async (reference: ARPose, entries: typeof pendingEntries, missing: number) => {
    setPendingScene(null);
    const results = await Promise.all(entries.map((e) => placeProduct(e.product, { pose: toWorldPose(reference, e.saved.pose) })));
    const notPlaced = entries.filter((_, i) => results[i] === null).map((e) => e.product.name);
    if (notPlaced.length > 0) {
      showToast(`Couldn't place ${notPlaced.join(', ')} (something is in the way).`);
    } else if (missing > 0) {
      showToast(`${missing} item${missing > 1 ? 's are' : ' is'} no longer in the catalog.`);
    }
    dirty.current = notPlaced.length + missing > 0;
  };

  // A scene whose items have cloud anchors: look for all of them at once. Each item comes back
  // at exactly its own spot as soon as its anchor is recognized (and keeps following it while
  // ARCore refines it). Once one is found the others get RESTORE_WINDOW_MS more; the items
  // still missing then, or without an anchor, are placed around the found ones (fitReference).
  // None found: back to placing the scene where the user points.
  useEffect(() => {
    const ar = arRef.current;
    if (!pendingScene || restoreMode !== 'anchor' || tracking !== 'normal' || restoreRun.current || !ar) return;
    const sceneItemCount = pendingScene.items.length;
    const entries = pendingEntries;
    const run: RestoreRun = { matches: [], restored: new Set(), failures: [], outstanding: 0, finished: false };
    restoreRun.current = run;

    const finish = async () => {
      if (run.finished) return;
      run.finished = true;
      clearTimeout(run.timer);
      // Best effort: nothing to stop once the view is gone.
      ar.stopResolvingCloudAnchors().catch(() => undefined);
      const reference = fitReference(run.matches);
      if (!reference) {
        restoreRun.current = null;
        setFound(0);
        const failure = run.failures.find((code) => code !== 'CANCELLED');
        if (failure) showToast(`Couldn't find its saved spot: ${errorMessage({ code: failure, message: '' })}`);
        setRestoreMode('aim');
        return;
      }
      setRestoring(true);
      try {
        await placeAround(reference, entries.filter((_, i) => !run.restored.has(i)), sceneItemCount - entries.length);
      } finally {
        setRestoring(false);
        restoreRun.current = null;
        setFound(0);
      }
    };

    entries.forEach((entry, index) => {
      const anchor = liveAnchor(entry.saved.anchor);
      if (!anchor) return;
      run.outstanding += 1;
      ar.resolveCloudAnchor(anchor.cloudAnchorId)
        .then(
          (pose) => {
            if (run.finished) return;
            run.matches.push({ world: pose, saved: entry.saved.pose });
            run.restored.add(index);
            setFound((n) => n + 1);
            if (run.timer === undefined) run.timer = setTimeout(() => void finish(), RESTORE_WINDOW_MS);
            void placeProduct(entry.product, { cloudAnchorId: anchor.cloudAnchorId });
          },
          (error: unknown) => {
            run.failures.push(errorCodeOf(error));
          },
        )
        .finally(() => {
          run.outstanding -= 1;
          if (run.outstanding === 0) void finish();
        });
    });
    if (run.outstanding === 0) void finish();
    // placeProduct / placeAround / pendingEntries are read once, for this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScene, restoreMode, tracking]);

  /** Stops looking for the saved spots and places the scene where the user points instead. */
  const placeHereInstead = () => {
    arRef.current?.stopResolvingCloudAnchors().catch(() => undefined);
    setRestoreMode('aim');
  };

  /**
   * Rebuilds a saved scene: the first item where the screen center points, the rest around
   * it. `auto`: started by itself (see AUTO_PLACE_DELAY_MS), so a miss is silent and retried.
   */
  const placeSavedScene = async (auto = false) => {
    if (!pendingScene) return;
    const missing = pendingScene.items.length - pendingEntries.length;
    const [first, ...rest] = pendingEntries;
    if (!first) {
      setPendingScene(null);
      showToast('The products in this scene are no longer available.');
      return;
    }
    setRestoring(true);
    quiet.current = auto;
    try {
      const firstId = await placeProduct(first.product, { silent: auto });
      quiet.current = false;
      if (!firstId) {
        if (auto && AUTO_RETRY_CODES.has(lastPlaceError.current ?? '')) setAutoAttempt((n) => n + 1);
        return;
      }
      const placed = (await arRef.current?.getPlacedItems()) ?? [];
      const firstPose = placed.find((p) => p.instanceId === firstId)?.pose;
      if (!firstPose) {
        setPendingScene(null);
        return;
      }
      await placeAround(referenceFromItem(firstPose, first.saved.pose), rest, missing);
    } finally {
      quiet.current = false;
      setRestoring(false);
    }
  };

  // Opening a saved scene: place it as soon as the AR view can (no button needed).
  const autoPlaceReady = pendingScene !== null && restoreMode === 'aim' && canPlace(guidanceInput);
  useEffect(() => {
    if (!autoPlaceReady) return;
    const timer = setTimeout(() => void placeSavedScene(true), AUTO_PLACE_DELAY_MS);
    return () => clearTimeout(timer);
    // placeSavedScene is recreated every render; the timer only needs the latest one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlaceReady, autoAttempt]);

  /** Takes the saved scene out and lets it be placed again (another spot, or after a bad start). */
  const replaceScene = () => {
    if (!savedInfo) return;
    const run = async () => {
      try {
        const fresh = await getScene(savedInfo.id);
        // An unfinished restore must not place anything into the new run.
        const previous = restoreRun.current;
        if (previous) {
          previous.finished = true;
          clearTimeout(previous.timer);
          restoreRun.current = null;
        }
        setFound(0);
        await arRef.current?.stopResolvingCloudAnchors();
        await arRef.current?.clearScene();
        dispatch({ type: 'cleared' });
        dirty.current = false;
        setNextProduct(null);
        setRestoreMode('aim'); // re-placing = choosing a new spot
        setPendingScene(fresh);
      } catch (error) {
        showToast(error instanceof Error ? error.message : 'Could not load the scene.');
      }
    };
    if (!dirty.current) {
      void run();
      return;
    }
    Alert.alert('Place the saved scene again?', 'Changes since the last save will be lost.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Re-place', style: 'destructive', onPress: () => void run() },
    ]);
  };

  const save = async (name: string) => {
    const ar = arRef.current;
    if (!ar) return;
    setSaving(true);
    // Close the dialog: the user has to see the camera to walk around the furniture.
    setSaveOpen(false);
    try {
      const placed = await ar.getPlacedItems();
      if (placed.length === 0) {
        showToast('Place something before saving.');
        return;
      }
      // Remember each item's spot in the room: a cloud anchor per item, all hosted at once (each
      // waits until its item has been seen well). An item still at a cloud anchor saved before
      // (restored and not moved) keeps it. The scene is saved even if some fail: those items
      // then come back around the others.
      const anchors = new Map<string, SceneAnchor>();
      const waiting = new Map(placed.map((p) => [p.instanceId, byId.get(p.productId)?.name ?? 'an item']));
      const showProgress = () => {
        const done = placed.length - waiting.size;
        setSaveProgress(
          done === 0
            ? 'Saving the spots in the room: walk slowly around the furniture, pointing at each piece…'
            : `Saved ${done} of ${placed.length} spots. Now point at ${listNames([...waiting.values()])}…`,
        );
      };
      showProgress();
      const problems: { code: string; message: string }[] = [];
      await Promise.all(
        placed.map(async (p) => {
          const reusableUntil = p.cloudAnchorId ? knownAnchors.current.get(p.cloudAnchorId) : undefined;
          if (p.cloudAnchorId && reusableUntil && Date.parse(reusableUntil) - Date.now() > ANCHOR_REUSE_MIN_MS) {
            anchors.set(p.instanceId, { cloudAnchorId: p.cloudAnchorId, expiresAt: reusableUntil });
          } else {
            try {
              const hosted = await ar.hostItemAnchor(p.instanceId);
              const anchor = {
                cloudAnchorId: hosted.cloudAnchorId,
                expiresAt: new Date(Date.now() + hosted.ttlDays * DAY_MS).toISOString(),
              };
              anchors.set(p.instanceId, anchor);
              knownAnchors.current.set(anchor.cloudAnchorId, anchor.expiresAt);
            } catch (error) {
              const problem = { code: errorCodeOf(error), message: error instanceof Error ? error.message : String(error) };
              console.warn(`Saving the spot of ${p.productId} failed: ${problem.code} ${problem.message}`);
              problems.push(problem);
            }
          }
          waiting.delete(p.instanceId);
          showProgress();
        }),
      );
      setSaveProgress('Saving…');
      const body = { name, items: toSceneItems(placed, isWallProduct, anchors) };
      const result = savedInfo ? await updateScene(savedInfo.id, body) : await createScene(body);
      setSavedInfo({ id: result.id, name: result.name });
      dirty.current = false;
      const without = placed.length - anchors.size;
      // Unknown codes show the native message, so the reason is never hidden.
      const problem = errorMessage(problems.find((p) => p.code !== 'CANCELLED') ?? problems[0] ?? { code: 'UNKNOWN', message: '' });
      showToast(
        without === 0
          ? `Saved “${result.name}” at this spot in the room.`
          : without === placed.length
            ? `Saved “${result.name}”, but not its exact spot: ${problem}`
            : `Saved “${result.name}”. ${without} of ${placed.length} items without their exact spot: ${problem}`,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the scene.');
    } finally {
      setSaving(false);
      setSaveProgress(null);
    }
  };

  /** Shares a photo of the room with the furniture (the selection and arrows are left out). */
  const sharePhoto = async () => {
    const ar = arRef.current;
    if (!ar) return;
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        showToast("Sharing isn't available on this device.");
        return;
      }
      const { uri } = await ar.captureSnapshot();
      await Sharing.shareAsync(uri, {
        mimeType: 'image/jpeg',
        UTI: 'public.jpeg',
        dialogTitle: `Share “${savedInfo?.name ?? 'New scene'}”`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      showToast(`Couldn't share the photo. ${errorMessage({ code: errorCodeOf(error), message })}`);
    } finally {
      setSharing(false);
    }
  };

  const removeSelected = async () => {
    const id = scene.selectedId;
    if (!id) return;
    await arRef.current?.removeItem(id);
    dispatch({ type: 'removed', instanceId: id });
    dirty.current = true;
  };

  const handleError = (error: ARErrorEvent) => {
    if (error.code === 'CAMERA_PERMISSION_DENIED' || error.code === 'AR_UNAVAILABLE' || error.code === 'SESSION_FAILED') {
      setFatalError(error);
    } else {
      showToast(errorMessage(error, surface ?? 'floor'));
    }
  };

  if (fatalError) {
    return (
      <BlockingMessage
        title="AR couldn't start"
        message={errorMessage(fatalError)}
        actionLabel={fatalError.code === 'CAMERA_PERMISSION_DENIED' ? 'Open settings' : undefined}
        onAction={fatalError.code === 'CAMERA_PERMISSION_DENIED' ? () => Linking.openSettings() : undefined}
      />
    );
  }

  const findingAnchors = pendingScene !== null && restoreMode === 'anchor';
  const isAiming = placingProduct !== null && !findingAnchors;
  const anchoredCount = pendingEntries.filter((e) => liveAnchor(e.saved.anchor)).length;
  const title = savedInfo?.name ?? 'New scene';
  const itemCount = scene.items.length;
  // Not while a saved scene is still coming back (saving would keep only part of it).
  const canSave = itemCount > 0 && !busy && !findingAnchors && !saving;
  const canShare = itemCount > 0 && !sharing && !saving;
  const hasList = shopping.lines.length > 0;
  const total = formatTotals(shopping.totals);
  const listSummary = `${shopping.itemCount} item${shopping.itemCount === 1 ? '' : 's'}${total ? ` · ${total}` : ''}`;

  return (
    <View style={styles.screen}>
      <FurnitureARView
        ref={arRef}
        style={StyleSheet.absoluteFill}
        showPlaneOverlay={isAiming}
        onTrackingStateChanged={(e) => setTracking(e.nativeEvent.state)}
        onPlaneDetected={(e) => {
          if (e.nativeEvent.kind === 'floor') setFloorCount(e.nativeEvent.count);
          else setWallCount(e.nativeEvent.count);
        }}
        onItemSelected={(e) => {
          dispatch({ type: 'selected', instanceId: e.nativeEvent.instanceId });
          if (e.nativeEvent.instanceId) dirty.current = true; // may be moved next
        }}
        onItemRemoved={(e) => {
          dispatch({ type: 'removed', instanceId: e.nativeEvent.instanceId });
          dirty.current = true;
        }}
        onPlacementBlocked={(e) => {
          if (!quiet.current) showToast(blockedMessage(e.nativeEvent.reason));
        }}
        onError={(e) => handleError(e.nativeEvent)}
      />

      {/* Center reticle: placement uses the ray through the middle of the screen. */}
      {isAiming && (
        <View pointerEvents="none" style={styles.reticleWrap}>
          <View style={[styles.reticle, canPlace(guidanceInput) && styles.reticleReady]} />
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={styles.roundButton}>
          <Text style={styles.roundButtonText}>✕</Text>
        </Pressable>
        {/* Name, item count and total; tap for the shopping list. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Shopping list: ${listSummary}`}
          accessibilityState={{ disabled: !hasList }}
          disabled={!hasList}
          onPress={() => setListOpen(true)}
          style={({ pressed }) => [styles.titlePill, pressed && styles.pillPressed]}
        >
          <Text style={styles.titleText} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.titleMeta} numberOfLines={1}>
            {listSummary}
            {hasList ? '  ›' : ''}
          </Text>
        </Pressable>
        {itemCount > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share a photo"
            accessibilityState={{ disabled: !canShare, busy: sharing }}
            disabled={!canShare}
            onPress={() => void sharePhoto()}
            style={[styles.sharePill, !canShare && styles.actionDisabled]}
          >
            {sharing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.shareText}>Share</Text>}
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSave }}
          disabled={!canSave}
          onPress={() => setSaveOpen(true)}
          style={[styles.savePill, !canSave && styles.actionDisabled]}
        >
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
        {saveProgress ? (
          <View style={[styles.hint, styles.progressHint]}>
            <ActivityIndicator color="#fff" size="small" />
            <Text style={styles.progressText}>{saveProgress}</Text>
          </View>
        ) : toast ? (
          <Text style={[styles.hint, styles.toast]}>{toast}</Text>
        ) : (
          <Text style={styles.hint}>
            {findingAnchors
              ? found === 0
                ? 'Look around where this scene was saved. It comes back at the same spot.'
                : `Found ${found} of ${anchoredCount}. Keep looking around to bring back the rest…`
              : pendingScene && placingProduct && tracking === 'normal'
              ? surface === 'wall'
                ? 'Point at the wall where the scene should be. It appears by itself.'
                : 'Point at the floor where the scene should be. It appears by itself.'
              : getGuidance(guidanceInput)}
          </Text>
        )}

        {selectedProduct && !isAiming && (
          <View style={styles.selectedCard}>
            <Image source={{ uri: selectedProduct.thumbnailUrl }} style={styles.selectedImage} />
            <View style={styles.selectedText}>
              <Text style={styles.selectedName} numberOfLines={1}>
                {selectedProduct.name}
              </Text>
              <Text style={styles.selectedPrice}>{formatPrice(selectedProduct.price, selectedProduct.currency)}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={removeSelected} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Remove</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => void openBuyPage(selectedProduct.id)}
              style={[styles.smallButton, styles.smallButtonPrimary]}
            >
              <Text style={styles.smallButtonPrimaryText}>Buy</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.actions}>
          {findingAnchors ? (
            found === 0 ? (
              <ActionButton label="Place it where I point instead" variant="secondary" onPress={placeHereInstead} />
            ) : (
              <ActionButton label="Restoring scene" onPress={() => undefined} loading />
            )
          ) : pendingScene ? (
            <ActionButton
              label="Place scene here"
              onPress={() => void placeSavedScene()}
              disabled={!canPlace(guidanceInput)}
              loading={busy}
            />
          ) : nextProduct ? (
            <>
              <ActionButton label="Cancel" variant="secondary" onPress={() => setNextProduct(null)} disabled={busy} />
              <ActionButton
                label={`Place ${nextProduct.name}`}
                onPress={placeNext}
                disabled={!canPlace(guidanceInput)}
                loading={busy}
                flex={2}
              />
            </>
          ) : (
            <>
              {savedInfo && itemCount > 0 && (
                <ActionButton label="Re-place scene" variant="secondary" onPress={replaceScene} disabled={busy} />
              )}
              <ActionButton label="＋ Add furniture" onPress={() => setPickerOpen(true)} disabled={busy} />
            </>
          )}
        </View>
      </View>

      <ProductPickerSheet
        visible={pickerOpen}
        products={products}
        onClose={() => setPickerOpen(false)}
        onPick={(product) => {
          setPickerOpen(false);
          setNextProduct(product);
        }}
      />
      <SaveSceneDialog
        visible={saveOpen}
        initialName={savedInfo?.name ?? ''}
        saving={saving}
        progress={saveProgress}
        onSave={save}
        onCancel={() => setSaveOpen(false)}
      />
      <ShoppingListSheet visible={listOpen} sceneName={title} list={shopping} onClose={() => setListOpen(false)} />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  flex = 1,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
  flex?: number;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.action,
        { flex },
        primary ? styles.actionPrimary : styles.actionSecondary,
        (disabled || loading) && styles.actionDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.accentText : colors.text} />
      ) : (
        <Text style={primary ? styles.actionPrimaryText : styles.actionSecondaryText} numberOfLines={1}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function BlockingMessage({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.blocking, { paddingTop: insets.top }]}>
      <Text style={styles.blockingTitle}>{title}</Text>
      <Text style={styles.blockingMessage}>{message}</Text>
      {actionLabel && onAction && (
        <Pressable accessibilityRole="button" onPress={onAction} style={[styles.action, styles.actionPrimary, styles.blockingButton]}>
          <Text style={styles.actionPrimaryText}>{actionLabel}</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.blockingBack}>
        <Text style={styles.blockingBackText}>Go back</Text>
      </Pressable>
    </View>
  );
}

const overlay = 'rgba(20, 20, 18, 0.62)';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  messageScreen: { flex: 1, backgroundColor: colors.background },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonText: { color: '#fff', fontSize: 18 },
  titlePill: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: overlay,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  pillPressed: { opacity: 0.8 },
  titleText: { color: '#fff', fontWeight: '600' },
  titleMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 12 },
  sharePill: { minWidth: 64, alignItems: 'center', backgroundColor: overlay, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10 },
  shareText: { color: '#fff', fontWeight: '600' },
  savePill: { backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  saveText: { color: colors.accentText, fontWeight: '700' },
  reticleWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  reticle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  reticleReady: { borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.25)' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, gap: spacing.sm + 4 },
  hint: {
    alignSelf: 'center',
    color: '#fff',
    backgroundColor: overlay,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
    textAlign: 'center',
  },
  toast: { backgroundColor: 'rgba(179, 38, 30, 0.85)' },
  progressHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: 'rgba(47, 93, 80, 0.92)' },
  progressText: { color: '#fff', flexShrink: 1 },
  selectedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 14,
    padding: spacing.sm,
  },
  selectedImage: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.border },
  selectedText: { flex: 1 },
  selectedName: { fontWeight: '600', color: colors.text },
  selectedPrice: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallButtonText: { color: colors.danger, fontWeight: '600' },
  smallButtonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  smallButtonPrimaryText: { color: colors.accentText, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  actionPrimary: { backgroundColor: colors.accent },
  actionSecondary: { backgroundColor: 'rgba(255,255,255,0.92)' },
  actionDisabled: { opacity: 0.5 },
  actionPrimaryText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
  actionSecondaryText: { color: colors.text, fontWeight: '600', fontSize: 16 },
  blocking: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  blockingTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  blockingMessage: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },
  blockingButton: { flex: 0, alignSelf: 'stretch', marginTop: spacing.md },
  blockingBack: { padding: spacing.md },
  blockingBackText: { color: colors.accent, fontWeight: '600' },
});

/** The anchor, if it has not expired. */
function liveAnchor(anchor: SceneAnchor | undefined): SceneAnchor | undefined {
  return anchor && Date.parse(anchor.expiresAt) > Date.now() ? anchor : undefined;
}

/** Whether any item of a saved scene has a cloud anchor that has not expired. */
function hasLiveAnchors(scene: SceneDto | null): boolean {
  return !!scene?.items.some((i) => liveAnchor(i.anchor));
}

/** "A", "A and B", "A, B and 2 more". */
function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}
