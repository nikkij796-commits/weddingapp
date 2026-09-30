/**
 * Which "keep this guide on your home screen" help to offer:
 *  - none:   already opened from the home screen
 *  - prompt: the browser offered its own install dialog (Android Chrome, Edge, desktop Chrome)
 *  - ios:    iPhone/iPad: Share, then Add to Home Screen
 *  - manual: anything else: use the browser menu
 */
export type InstallKind = 'none' | 'prompt' | 'ios' | 'manual';

export function isIos(ua: string, touchMac = false): boolean {
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  return /iPhone|iPad|iPod/.test(ua) || (touchMac && /Macintosh/.test(ua));
}

export function installKind(o: { ua: string; standalone: boolean; canPrompt: boolean; touchMac?: boolean }): InstallKind {
  if (o.standalone) return 'none';
  if (o.canPrompt) return 'prompt';
  if (isIos(o.ua, o.touchMac)) return 'ios';
  return 'manual';
}
