import { fireEvent, render, screen } from '@testing-library/react-native';
import { sofaDto } from '../test/fixtures';
import { ProductCard } from './ProductCard';

describe('ProductCard', () => {
  it('shows name, category and real-world dimensions', async () => {
    await render(<ProductCard product={sofaDto} onPress={() => {}} />);
    expect(screen.getByText('Oslo 3-Seater Sofa')).toBeTruthy();
    expect(screen.getByText('Sofas')).toBeTruthy();
    expect(screen.getByText('210 × 92 × 82 cm')).toBeTruthy();
  });

  it('calls onPress with the product', async () => {
    const onPress = jest.fn();
    await render(<ProductCard product={sofaDto} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Oslo 3-Seater Sofa' }));
    expect(onPress).toHaveBeenCalledWith(sofaDto);
  });
});
