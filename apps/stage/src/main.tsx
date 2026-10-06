import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app';

// No StrictMode: the stage is animation-heavy and React's development-only
// double-invocation replays every entrance tween, which makes real timing
// impossible to judge while building. Production behaviour is identical.
const root = document.getElementById('app');
if (root) createRoot(root).render(<App />);
