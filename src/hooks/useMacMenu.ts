import { useEffect, useRef } from "react";
import { Menu, Submenu, MenuItem, PredefinedMenuItem, CheckMenuItem } from "@tauri-apps/api/menu";
import type { Translations } from "../i18n/translations";

// Menu action handlers — App passes callbacks bound to current state.
export interface MacMenuHandlers {
  newFile: () => void;
  openLrc: () => void;
  openAudio: () => void;
  save: () => void;
  saveAsLrc: () => void;
  saveAsSrt: () => void;
  undo: () => void;
  redo: () => void;
  togglePlay: () => void;
  skip: (delta: number) => void;
  stop: () => void;
  modeFile: () => void;
  modeSpotify: () => void;
  modeYouTube: () => void;
  openSettings: () => void;
  openPreview: () => void;
  openHelp: () => void;
}

export interface MacMenuState {
  t: Translations;
  spotifyMode: boolean;
  youtubeMode: boolean;
  ytdlpInstalled: boolean;
}

const isMac =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

// Configures native menu in macOS system menubar.
// No-op on Windows/Linux (in-app header toolbar is used directly).
export function useMacMenu(handlers: MacMenuHandlers, state: MacMenuState) {
  // Handlers kept in ref to always refer to latest values without recreating menu
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const h = () => hRef.current;

  const { t, spotifyMode, youtubeMode, ytdlpInstalled } = state;

  useEffect(() => {
    if (!isMac) return;
    let cancelled = false;

    (async () => {
      const sep = () => PredefinedMenuItem.new({ item: "Separator" });
      const item = (text: string, action: () => void, accelerator?: string) =>
        MenuItem.new({ text, accelerator, action });

      const appMenu = await Submenu.new({
        text: "Lyrical Sync",
        items: [
          await PredefinedMenuItem.new({ item: { About: null } }),
          await sep(),
          await item(t.menu.settings, () => h().openSettings(), "CmdOrCtrl+,"),
          await sep(),
          await PredefinedMenuItem.new({ item: "Services" }),
          await sep(),
          await PredefinedMenuItem.new({ item: "Hide" }),
          await PredefinedMenuItem.new({ item: "HideOthers" }),
          await PredefinedMenuItem.new({ item: "ShowAll" }),
          await sep(),
          await PredefinedMenuItem.new({ item: "Quit" }),
        ],
      });

      const fileMenu = await Submenu.new({
        text: t.menu.file,
        items: [
          await item(t.newFileBtn, () => h().newFile(), "CmdOrCtrl+N"),
          await item(t.openLrc, () => h().openLrc(), "CmdOrCtrl+O"),
          await item(t.openAudio, () => h().openAudio()),
          await sep(),
          await item(t.save, () => h().save(), "CmdOrCtrl+S"),
          await item(t.menu.saveAsLrc, () => h().saveAsLrc(), "CmdOrCtrl+Shift+S"),
          await item(t.menu.saveAsSrt, () => h().saveAsSrt()),
        ],
      });

      // Document-level undo/redo does not set accelerators to avoid conflict
      // with native text input editing (Cmd+Z). Global handler handles keyboard Cmd+Z.
      const editMenu = await Submenu.new({
        text: t.menu.edit,
        items: [
          await item(t.undo, () => h().undo()),
          await item(t.redo, () => h().redo()),
          await sep(),
          await PredefinedMenuItem.new({ item: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste" }),
          await PredefinedMenuItem.new({ item: "SelectAll" }),
        ],
      });

      // Playback items have no accelerators (prevents collision with app number/space hotkeys)
      const playMenu = await Submenu.new({
        text: t.menu.playback,
        items: [
          await item(t.menu.playPause, () => h().togglePlay()),
          await sep(),
          await item(t.menu.skipBack5, () => h().skip(-5)),
          await item(t.menu.skipBack1, () => h().skip(-1)),
          await item(t.menu.skipFwd1, () => h().skip(1)),
          await item(t.menu.skipFwd5, () => h().skip(5)),
          await sep(),
          await item(t.menu.stop, () => h().stop()),
        ],
      });

      const modeMenu = await Submenu.new({
        text: t.menu.mode,
        items: [
          await CheckMenuItem.new({
            text: t.modeFile,
            checked: !spotifyMode && !youtubeMode,
            action: () => h().modeFile(),
          }),
          await CheckMenuItem.new({
            text: "Spotify",
            checked: spotifyMode && !youtubeMode,
            action: () => h().modeSpotify(),
          }),
          await CheckMenuItem.new({
            text: t.modeYouTube,
            checked: youtubeMode,
            enabled: ytdlpInstalled,
            action: () => h().modeYouTube(),
          }),
        ],
      });

      const viewMenu = await Submenu.new({
        text: t.menu.view,
        items: [await item(t.previewBtn, () => h().openPreview())],
      });

      const helpMenu = await Submenu.new({
        text: t.menu.help,
        items: [await item(t.shortcutsTitle, () => h().openHelp())],
      });

      const menu = await Menu.new({
        items: [appMenu, fileMenu, editMenu, playMenu, modeMenu, viewMenu, helpMenu],
      });

      if (cancelled) return;
      await menu.setAsAppMenu();
    })();

    return () => {
      cancelled = true;
    };
    // Rebuild menu when labels (language), mode checkmarks, or YouTube availability change
  }, [t, spotifyMode, youtubeMode, ytdlpInstalled]);
}
