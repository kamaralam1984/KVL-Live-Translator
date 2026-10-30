/// <reference types="vite/client" />

import type { KvlAPI } from '../../preload';

declare global {
  interface Window {
    kvlAPI: KvlAPI;
  }
}
