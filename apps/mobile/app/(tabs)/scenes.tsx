import { useCallback, useMemo, useRef, type ReactElement } from 'react';
import { Alert, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import type { ProductDto, SceneDto } from '@airoom/shared';
import { deleteScene, getProducts, getScenes } from '../../src/api/client';
import { EmptyView, ErrorView, LoadingView } from '../../src/components/StateViews';
import { colors, spacing } from '../../src/components/theme';
import { useAsync } from '../../src/hooks/useAsync';
import { buildShoppingList, formatTotals } from '../../src/utils/shoppingList';

/** Saved AR scenes: open one to rebuild it in the room, or start a new one. */
export default function ScenesScreen() {
  const scenes = useAsync((signal) => getScenes(signal), []);
  // For thumbnails and totals; scenes only store product ids.
  const products = useAsync((signal) => getProducts({}, signal), []);
  const byId = useMemo(() => new Map((products.data ?? []).map((p) => [p.id, p])), [products.data]);

  // Back from the AR screen (a scene may have been saved): refresh. The first focus is the
  // initial load, already running.
  const { reload } = scenes;
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedBefore.current) reload();
      focusedBefore.current = true;
    }, [reload]),
  );

  const confirmDelete = (scene: SceneDto) =>
    Alert.alert(`Delete “${scene.name}”?`, 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteScene(scene.id).then(reload, (e: unknown) =>
            Alert.alert('Could not delete the scene', e instanceof Error ? e.message : undefined),
          ),
      },
    ]);

  let content: ReactElement;
  if (scenes.status === 'error' && !scenes.data) {
    content = <ErrorView message={scenes.error.message} onRetry={reload} />;
  } else if (!scenes.data) {
    content = <LoadingView />;
  } else {
    content = (
      <FlatList
        data={scenes.data}
        keyExtractor={(s) => s.id}
        contentContainerStyle={[styles.list, scenes.data.length === 0 && styles.empty]}
        refreshing={scenes.status === 'loading'}
        onRefresh={reload}
        ListEmptyComponent={
          <EmptyView title="No scenes yet" message="Create a scene, add furniture in your room and save it." />
        }
        renderItem={({ item }) => (
          <SceneRow
            scene={item}
            products={byId}
            onOpen={() => router.push({ pathname: '/ar', params: { sceneId: item.id } })}
            onDelete={() => confirmDelete(item)}
          />
        )}
      />
    );
  }

  return (
    <View style={styles.container}>
      {content}
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/ar')} style={styles.newButton}>
          <Text style={styles.newButtonText}>＋ New scene</Text>
        </Pressable>
      </View>
    </View>
  );
}

function SceneRow({
  scene,
  products,
  onOpen,
  onDelete,
}: {
  scene: SceneDto;
  products: Map<string, ProductDto>;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const thumbnails = [...new Set(scene.items.map((i) => i.productId))]
    .flatMap((id) => {
      const product = products.get(id);
      return product ? [product] : [];
    })
    .slice(0, 4);
  const count = scene.items.length;
  // Empty until the catalog has loaded.
  const total = formatTotals(buildShoppingList(scene.items.map((i) => i.productId), products).totals);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${scene.name}`}
      onPress={onOpen}
      onLongPress={onDelete}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.thumbs}>
        {thumbnails.map((p) => (
          <Image key={p.id} source={{ uri: p.thumbnailUrl }} style={styles.thumb} />
        ))}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {scene.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {count} item{count === 1 ? '' : 's'}
          {total ? ` · ${total}` : ''} · {new Date(scene.updatedAt).toLocaleDateString()}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${scene.name}`} onPress={onDelete} hitSlop={10}>
        <Text style={styles.delete}>Delete</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: spacing.md, gap: spacing.sm },
  empty: { flexGrow: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: { opacity: 0.85 },
  thumbs: { width: 64, height: 64, flexDirection: 'row', flexWrap: 'wrap', borderRadius: 8, overflow: 'hidden', backgroundColor: colors.border },
  thumb: { width: 32, height: 32 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted },
  delete: { color: colors.danger, fontWeight: '600' },
  footer: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background },
  newButton: { backgroundColor: colors.accent, borderRadius: 12, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
  newButtonText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
});
