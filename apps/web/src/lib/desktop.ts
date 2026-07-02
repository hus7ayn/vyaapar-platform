export interface DesktopBridge {
  isDesktop: true;
  getDeviceId: () => Promise<string>;
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && !!(window as Window & { desktop?: DesktopBridge }).desktop?.isDesktop;
}

export async function getDesktopDeviceId(): Promise<string | null> {
  if (!isDesktopApp()) return null;
  return (window as Window & { desktop: DesktopBridge }).desktop.getDeviceId();
}
