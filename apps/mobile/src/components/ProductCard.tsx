import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProductDto } from '@airoom/shared';
import { formatDimensions, formatPrice } from '../utils/format';
import { colors, spacing } from './theme';

interface Props {
  product: ProductDto;
  onPress: (product: ProductDto) => void;
}

export function ProductCard({ product, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={product.name}
      onPress={() => onPress(product)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Image source={{ uri: product.thumbnailUrl }} style={styles.image} />
      <View style={styles.body}>
        <Text style={styles.category}>{product.category.name}</Text>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        <Text style={styles.price}>{formatPrice(product.price, product.currency)}</Text>
        <Text style={styles.dimensions}>{formatDimensions(product.dimensions)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.85 },
  image: { width: '100%', aspectRatio: 1, backgroundColor: colors.border },
  body: { padding: spacing.sm + 2, gap: 2 },
  category: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: colors.textMuted },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  price: { fontSize: 15, color: colors.accent, fontWeight: '600', marginTop: 2 },
  dimensions: { fontSize: 12, color: colors.textMuted },
});
