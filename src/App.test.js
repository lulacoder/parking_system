import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the welcome message for the car parking app', () => {
  render(<App />);
  
  const welcomeElement = screen.getByText(/Welcome to Endarase Car Parking!/i);
  expect(welcomeElement).toBeInTheDocument();
});