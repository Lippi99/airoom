import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { ProductDto } from '@airoom/shared';
import { ApiError } from '../../src/api/client';
import { ErrorView, LoadingView } from '../../src/components/StateViews';
import { colors, spacing } from '../../src/components/theme';
import { useProduct } from '../../src/hooks/useCatalog';
import { useFavorites } from '../../src/store/favorites';
import { openBuyPage } from '../../src/utils/buy';
import { formatDimensions, formatPrice } from '../../src/utils/format';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const product = useProduct(id);

  if (product.status === 'error') {
    const message =
      product.error instanceof ApiError && product.error.status === 404
        ? 'This product is no longer available.'
        : product.error.message;
    return <ErrorView message={message} onRetry={product.reload} />;
  }
  if (!product.data) return <LoadingView />;

  return <ProductDetails product={product.data} />;
}

function ProductDetails({ product }: { product: ProductDto }) {
  const { isFavorite, toggleFavorite } = useFavorites();
  const saved = isFavorite(product.id);

  return (
    <>
      <Stack.Screen options={{ title: product.name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Image source={{ uri: product.thumbnailUrl }} style={styles.image} />

        <View style={styles.section}>
          <Text style={styles.category}>{product.category.name}</Text>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.price}>{formatPrice(product.price, product.currency)}</Text>
          <Text style={styles.retailer}>Sold by {product.retailer.name}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Dimensions (W × D × H)</Text>
          <Text style={styles.value}>{formatDimensions(product.dimensions)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Description</Text>
          <Text style={styles.value}>{product.description}</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/ar', params: { productId: product.id } })}
          style={[styles.button, styles.primary, styles.arButton]}
        >
          <Text style={styles.primaryText}>View in your room</Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => toggleFavorite(product.id)}
            style={[styles.button, styles.secondary]}
          >
            <Text style={styles.secondaryText}>{saved ? 'Saved ✓' : 'Save'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => void openBuyPage(product.id)} style={[styles.button, styles.primary]}>
            <Text style={styles.primaryText}>Buy at {product.retailer.name}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.lg * 2 },
  image: { width: '100%', aspectRatio: 1, backgroundColor: colors.border },
  section: { paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: 4 },
  category: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textMuted },
  name: { fontSize: 22, fontWeight: '700', color: colors.text },
  price: { fontSize: 20, fontWeight: '600', color: colors.accent },
  retailer: { color: colors.textMuted },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  value: { fontSize: 15, color: colors.text, lineHeight: 21 },
  arButton: { marginHorizontal: spacing.md, marginTop: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  button: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  primary: { flex: 2, backgroundColor: colors.accent },
  primaryText: { color: colors.accentText, fontWeight: '600', fontSize: 16 },
  secondary: { flex: 1, borderWidth: 1, borderColor: colors.accent },
  secondaryText: { color: colors.accent, fontWeight: '600', fontSize: 16 },
});
