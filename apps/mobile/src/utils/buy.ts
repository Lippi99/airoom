import { Alert, Linking } from 'react-native';
import { getBuyUrl } from '../api/client';

/**
 * Opens a product's page at its retailer, always through the API's click-tracking redirect
 * (`/go/:productId`), never the retailer URL itself.
 */
export async function openBuyPage(productId: string): Promise<void> {
  try {
    await Linking.openURL(getBuyUrl(productId));
  } catch {
    Alert.alert('Could not open the store', 'Please try again in a moment.');
  }
}
