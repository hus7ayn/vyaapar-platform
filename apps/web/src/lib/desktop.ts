export interface DesktopBridge {
  isDesktop: true;
  getDeviceId: () => Promise<string>;
  getServerUrl: () => Promise<string | null>;
  setServerUrl: (url: string) => Promise<void>;
  retryConnection: () => Promise<void>;
}

function getBridge(): DesktopBridge | undefined {
  return (window as Window & { desktop?: DesktopBridge }).desktop;
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!getBridge()?.isDesktop;
}

export async function getDesktopDeviceId(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  return getBridge()!.getDeviceId();
}
