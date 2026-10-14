import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ProductDto } from '@airoom/shared';
import {
  FurnitureARView,
  type ARErrorEvent,
  type FurnitureARViewRef,
  type TrackingState,
} from '../modules/furniture-ar';
import { getBuyUrl } from '../src/api/client';
import { blockedMessage, canPlace, errorCodeOf, errorMessage, getGuidance, surfaceFor } from '../src/ar/guidance';
import { ErrorView, LoadingView } from '../src/components/StateViews';
import { colors, spacing } from '../src/components/theme';
import { useARAvailability } from '../src/hooks/useARAvailability';
import { useProduct } from '../src/hooks/useCatalog';
import { newInstanceId, useSceneState } from '../src/store/scene';

const TOAST_MS = 2500;

export default function ARScreen() {
  const { productId } = useLocalSearchParams<{ productId: string }>();
  const product = useProduct(productId);
  const { availability, retry } = useARAvailability();

  let content: ReactElement;
  let isCamera = false;
  if (product.status === 'error') {
    content = <ErrorView message={product.error.message} onRetry={product.reload} />;
  } else if (!product.data || availability.status === 'checking') {
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
    content = <ARSession product={product.data} />;
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

function ARSession({ product }: { product: ProductDto }) {
  const insets = useSafeAreaInsets();
  const arRef = useRef<FurnitureARViewRef>(null);
  const [scene, dispatch] = useSceneState();
  const [tracking, setTracking] = useState<TrackingState | null>(null);
  const [floorCount, setFloorCount] = useState(0);
  const [wallCount, setWallCount] = useState(0);
  const [fatalError, setFatalError] = useState<ARErrorEvent | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Furniture goes on the floor, wall art on a wall: hints, checks and messages follow.
  const surface = surfaceFor(product.category.slug);
  const guidanceInput = {
    surface,
    tracking,
    floorCount,
    wallCount,
    itemCount: scene.items.length,
    isPlacing: scene.placingId !== null,
  };

  const place = async () => {
    const instanceId = newInstanceId(product.id);
    dispatch({ type: 'placeStarted', instanceId });
    try {
      await arRef.current?.placeItem({
        instanceId,
        productId: product.id,
        category: product.category.slug,
        glbUrl: product.model.glbUrl,
        usdzUrl: product.model.usdzUrl,
        dimensions: product.dimensions,
      });
      dispatch({ type: 'placeSucceeded', item: { instanceId, productId: product.id } });
    } catch (error) {
      dispatch({ type: 'placeFailed', instanceId });
      const code = errorCodeOf(error);
      // MODEL_LOAD_FAILED also arrives through onError, which shows the same toast;
      // CANCELLED means the user removed it while loading.
      if (code !== 'MODEL_LOAD_FAILED' && code !== 'CANCELLED') showToast(errorMessage({ code, message: '' }, surface));
    }
  };

  const removeSelected = async () => {
    const id = scene.selectedId;
    if (!id) return;
    await arRef.current?.removeItem(id);
    dispatch({ type: 'removed', instanceId: id });
  };

  const handleError = (error: ARErrorEvent) => {
    if (error.code === 'CAMERA_PERMISSION_DENIED' || error.code === 'AR_UNAVAILABLE' || error.code === 'SESSION_FAILED') {
      setFatalError(error);
    } else {
      showToast(errorMessage(error, surface));
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

  return (
    <View style={styles.screen}>
      <FurnitureARView
        ref={arRef}
        style={StyleSheet.absoluteFill}
        showPlaneOverlay={scene.items.length === 0}
        onTrackingStateChanged={(e) => setTracking(e.nativeEvent.state)}
        onPlaneDetected={(e) => {
          if (e.nativeEvent.kind === 'floor') setFloorCount(e.nativeEvent.count);
          else setWallCount(e.nativeEvent.count);
        }}
        onItemSelected={(e) => dispatch({ type: 'selected', instanceId: e.nativeEvent.instanceId })}
        onPlacementBlocked={(e) => showToast(blockedMessage(e.nativeEvent.reason))}
        onError={(e) => handleError(e.nativeEvent)}
      />

      {/* Center reticle: placement uses the ray through the middle of the screen. */}
      {scene.items.length === 0 && (
        <View pointerEvents="none" style={styles.reticleWrap}>
          <View style={[styles.reticle, canPlace(guidanceInput) && styles.reticleReady]} />
        </View>
      )}

      <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Close AR" onPress={() => router.back()} style={styles.roundButton}>
          <Text style={styles.roundButtonText}>✕</Text>
        </Pressable>
        <View style={styles.titlePill}>
          <Text style={styles.titleText} numberOfLines={1}>
            {product.name}
          </Text>
        </View>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.md }]} pointerEvents="box-none">
        {toast ? (
          <Text style={[styles.hint, styles.toast]}>{toast}</Text>
        ) : (
          <Text style={styles.hint}>{getGuidance(guidanceInput)}</Text>
        )}

        <View style={styles.actions}>
          {scene.selectedId ? (
            <ActionButton label="Remove" onPress={removeSelected} variant="secondary" />
          ) : null}
          <ActionButton
            label={scene.items.length === 0 ? 'Place' : 'Place another'}
            onPress={place}
            disabled={!canPlace(guidanceInput)}
            loading={scene.placingId !== null}
          />
          <ActionButton label="Buy" onPress={() => Linking.openURL(getBuyUrl(product.id))} variant="secondary" />
        </View>
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={[styles.action, primary ? styles.actionPrimary : styles.actionSecondary, (disabled || loading) && styles.actionDisabled]}
    >
      {loading ? (
        <ActivityIndicator color={colors.accentText} />
      ) : (
        <Text style={primary ? styles.actionPrimaryText : styles.actionSecondaryText}>{label}</Text>
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
        <Text style={styles.blockingBackText}>Back to product</Text>
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
  titlePill: { flexShrink: 1, backgroundColor: overlay, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9 },
  titleText: { color: '#fff', fontWeight: '600' },
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
