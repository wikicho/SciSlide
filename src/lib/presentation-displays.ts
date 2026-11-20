// The Window Management API is still optional in browsers.
interface DisplayScreen extends Screen {
  left: number;
  top: number;
  availLeft: number;
  availTop: number;
  isInternal: boolean;
}

interface ScreenDetails extends EventTarget {
  currentScreen: DisplayScreen;
  screens: DisplayScreen[];
}

export interface AudienceDisplay {
  features: string;
  watchDisconnect?: (onDisconnect: () => void) => () => void;
}

export function browserAudienceDisplay(): Promise<AudienceDisplay | null> | null {
  const browser = window as Window & {
    getScreenDetails?: () => Promise<ScreenDetails>;
  };
  if (
    !(window.screen as Screen & { isExtended?: boolean }).isExtended ||
    !browser.getScreenDetails
  )
    return null;

  return browser
    .getScreenDetails()
    .then((details) => {
      const presenter = details.currentScreen;
      const otherScreens = details.screens.filter(
        (screen) =>
          screen.left !== presenter.left || screen.top !== presenter.top,
      );
      const target =
        otherScreens.find((screen) => !screen.isInternal) ?? otherScreens[0];
      if (!target) return null;
      return {
        features: `popup,fullscreen,left=${target.availLeft},top=${target.availTop},width=${target.availWidth},height=${target.availHeight}`,
        watchDisconnect(onDisconnect) {
          const check = () => {
            if (
              !details.screens.includes(target) ||
              !details.screens.includes(presenter) ||
              (target.left === presenter.left && target.top === presenter.top)
            )
              onDisconnect();
          };
          details.addEventListener("screenschange", check);
          return () => details.removeEventListener("screenschange", check);
        },
      } satisfies AudienceDisplay;
    })
    .catch(() => null);
}
