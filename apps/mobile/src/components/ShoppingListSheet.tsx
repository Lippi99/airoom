import { FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openBuyPage } from '../utils/buy';
import { formatPrice } from '../utils/format';
import { formatTotals, type ShoppingList } from '../utils/shoppingList';
import { EmptyView } from './StateViews';
import { colors, spacing } from './theme';

interface Props {
  visible: boolean;
  sceneName: string;
  list: ShoppingList;
  onClose: () => void;
}

/** Bottom sheet with a scene's products: price, a Buy button for each, and the total. */
export function ShoppingListSheet({ visible, sceneName, list, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { itemCount, missing } = list;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Shopping list</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {sceneName}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <FlatList
          style={styles.listView}
          data={list.lines}
          keyExtractor={(line) => line.product.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyView title="Nothing here yet" message="Add furniture to the scene to see what it costs." />}
          renderItem={({ item: { product, quantity } }) => {
            const price = formatPrice(product.price, product.currency);
            return (
              <View style={styles.line}>
                <Image source={{ uri: product.thumbnailUrl }} style={styles.image} />
                <View style={styles.lineText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {product.name}
                  </Text>
                  <Text style={styles.retailer} numberOfLines={1}>
                    {product.retailer.name}
                  </Text>
                  <Text style={styles.price}>{quantity > 1 ? `${quantity} × ${price}` : price}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Buy ${product.name}`}
                  onPress={() => void openBuyPage(product.id)}
                  style={({ pressed }) => [styles.buy, pressed && styles.pressed]}
                >
                  <Text style={styles.buyText}>Buy</Text>
                </Pressable>
              </View>
            );
          }}
        />
        {list.totals.length > 0 && (
          <View style={styles.footer}>
            <Text style={styles.totalLabel}>
              Total · {itemCount} item{itemCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.total}>{formatTotals(list.totals)}</Text>
          </View>
        )}
        {missing > 0 && (
          <Text style={styles.note}>
            {missing === 1 ? '1 item of this scene is' : `${missing} items of this scene are`} no longer in the catalog.
          </Text>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  sheet: {
    maxHeight: '75%',
    backgroundColor: colors.background,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted },
  close: { fontSize: 18, color: colors.textMuted },
  // Sized by its lines, up to the sheet's max height.
  listView: { flexGrow: 0, flexShrink: 1 },
  list: { padding: spacing.md, gap: spacing.sm },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  image: { width: 52, height: 52, borderRadius: 8, backgroundColor: colors.border },
  lineText: { flex: 1, gap: 1 },
  name: { fontWeight: '600', color: colors.text },
  retailer: { fontSize: 12, color: colors.textMuted },
  price: { color: colors.accent, fontWeight: '600', fontSize: 13 },
  buy: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  pressed: { opacity: 0.8 },
  buyText: { color: colors.accentText, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: 15, color: colors.textMuted },
  total: { flexShrink: 1, fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'right' },
  note: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, fontSize: 13, color: colors.textMuted },
});
