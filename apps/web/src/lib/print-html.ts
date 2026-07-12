import { toast } from 'sonner';

/**
 * Opens `content` in a new window and triggers the browser print dialog.
 * `window.open` returning `null` (e.g. a blocked popup) doesn't throw, so a
 * plain try/catch around it silently does nothing — check the return value
 * instead so a blocked popup surfaces a visible, actionable error.
 */
export function printHtmlDocument(content: string): boolean {
  try {
    const w = window.open('', '_blank');
    if (!w) {
      toast.error('Enable pop-ups for this site to print');
      return false;
    }
    w.document.write(content);
    w.document.close();
    w.onload = () => w.print();
    return true;
  } catch {
    toast.error('Failed to open print window');
    return false;
  }
}
