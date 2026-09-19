/**
 * Generate a URL that works in both the dev server and packaged Electron.
 * Public assets must not be referenced with absolute paths under file://.
 */
export const publicAsset = (filename: string) =>
  `${import.meta.env.BASE_URL}${filename.replace(/^\//, '')}`;
