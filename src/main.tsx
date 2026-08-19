import { createRoot } from 'react-dom/client';
import ManualFlightApp from './components/ManualFlightApp';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('The application root element was not found.');
}

createRoot(rootElement).render(<ManualFlightApp />);
