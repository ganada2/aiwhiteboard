import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  appName: 'aiboard',
  brand: {
    primaryColor: '#10B981',
  },
  permissions: [],
  webView: {
    bounces: false,
    pullToRefreshEnabled: false,
    overScrollMode: 'never',
    allowsBackForwardNavigationGestures: false,
  },
  webBundleDir: 'dist',
});
