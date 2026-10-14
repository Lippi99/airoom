import { Platform } from 'react-native';
import { ApiError, getBuyUrl, getProduct, getProducts } from './client';
import { API_URL } from '../config';
import { sofaDto } from '../test/fixtures';

function mockFetchOnce(status: number, body: unknown) {
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  globalThis.fetch = jest.fn();
});

describe('api client', () => {
  it('builds the products query string', async () => {
    mockFetchOnce(200, []);
    await getProducts({ category: 'rug', search: '  wool ' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${API_URL}/products?category=rug&search=wool`,
      expect.anything(),
    );
  });

  it('omits empty filters', async () => {
    mockFetchOnce(200, []);
    await getProducts({ search: '   ' });
    expect(globalThis.fetch).toHaveBeenCalledWith(`${API_URL}/products`, expect.anything());
  });

  it('returns the parsed product', async () => {
    mockFetchOnce(200, sofaDto);
    await expect(getProduct('prod-sofa-oslo')).resolves.toEqual(sofaDto);
  });

  it('throws ApiError with status and server message', async () => {
    mockFetchOnce(404, { error: 'NOT_FOUND', message: 'Product "x" not found' });
    const err = await getProduct('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Product "x" not found' });
  });

  it('maps network failures to ApiError with null status', async () => {
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(getProduct('x')).rejects.toMatchObject({ name: 'ApiError', status: null });
  });
});

describe('getBuyUrl', () => {
  it('points to the tracked /go link with the current platform, never the retailer', () => {
    expect(getBuyUrl('prod-sofa-oslo')).toBe(`${API_URL}/go/prod-sofa-oslo?platform=${Platform.OS}`);
  });
});
