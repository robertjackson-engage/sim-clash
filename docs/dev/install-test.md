# Install test: 15 minutes on a clean PC

The build is checked by machine as far as a machine can go without opening the game
(`docs/dev/release-checklist.md` says how). This is the part only a person can do: install
the real installer on a **second Windows PC that has never had the game or Open-Birdie on
it**, and play. A fresh Windows user account on the same PC is second best. Do it for every
release.

Write down anything that is not as described, with a photo of the screen if you can.

You need: the installer (`Sim-Clash-Setup-<version>.exe`), downloaded through a browser from
where players will get it (a file copied over on a USB stick skips SmartScreen and tests
nothing), a mouse and keyboard, sound on. A launch monitor is optional; step 6 has both ways.

## 1. Download and SmartScreen (2 min)

- [ ] The browser downloads the file without calling it dangerous. (Edge may say it "is not
      commonly downloaded": choose Keep.)
- [ ] Double-click it. An unsigned build shows **"Windows protected your PC"**. **More
      info** shows the file name and "Unknown publisher"; **Run anyway** is there.
      A signed build: note the publisher name shown.
- [ ] If the PC has Smart App Control on (Windows Security, App & browser control) and the
      build is unsigned, it is blocked with no way through. Note it; that is expected.

## 2. Install (1 min)

- [ ] No administrator (UAC) prompt.
- [ ] A small window with the game's icon and a progress bar, for well under a minute.
- [ ] The game starts by itself when it finishes.
- [ ] Afterwards there is a **Sim Clash** shortcut on the desktop and in the Start menu,
      both with the game's icon, and **Sim Clash** in Windows Settings, Apps, Installed
      apps, with a version number and a size of roughly 470 MB.

## 3. First start (2 min)

- [ ] The window opens at once, **dark**, full screen on the main display, showing the
      wordmark and LOADING. No white flash, no empty window, no console window.
- [ ] Within about ten seconds the title screen replaces it.
- [ ] **Windows Firewall** asks about the game once (it listens for launch monitors on
      port 921). Choose **Cancel** this time: the game must still work with a connector on
      the same PC. (Test "allow on private networks" on another run if your connector is on
      a second device.)
- [ ] The first-run launch monitor wizard appears and can be followed or skipped.
- [ ] There is sound: a click on a menu item makes one.

## 4. The window (1 min)

- [ ] **F11** switches to a window and back. **Alt+Enter** does the same.
- [ ] Leave it windowed, quit the game from its menu, start it from the desktop shortcut: it
      comes back windowed. Press F11: full screen. Quit and start again: full screen.
- [ ] With the game running, double-click the desktop shortcut again: the running game
      comes to the front. No second window, no error.

## 5. A look round (2 min)

- [ ] Every item on the main menu opens and can be left again with Esc or its back button.
- [ ] Nothing mentions real courses, course downloads, or Open-Birdie outside the credits.
- [ ] The credits name Open-Birdie and both of its authors.
- [ ] How to play is readable from where you would stand in the bay.
- [ ] With the network cable out or Wi-Fi off: SOLO, SINGLE STAGE, **Canyon Run** has a
      warm, low golden-hour sky and **Frostbite Ridge** a clear morning one (not the same
      flat midday sky on both). The two sky photos are installed with the game; it
      downloads nothing.

## 6. Hit some balls (3 min)

Without a launch monitor:

- [ ] PRACTICE, FREE PLAY, any stage. Press **TEST SWING** (bottom right). The ball flies,
      the camera follows it, there is a strike sound, a crowd, a callout banner, and the
      ball stops.
- [ ] Press **T**, choose CHIP: a short shot, a different verdict. Choose SLIDERS: the panel
      with ball speed, launch, direction and spin opens and **Hit it** plays that shot.

With a launch monitor:

- [ ] Follow the wizard for your monitor. The chip at the top right changes from **Monitor
      waiting** to **Monitor connected**.
- [ ] Hit a real ball. The shot appears within a second or so, and the carry is believable
      next to your launch monitor's own number.

## 7. A quick match (3 min)

- [ ] Main menu, **VERSUS**: one tap for two players (or type two names), **Quick match**,
      any stage, START.
- [ ] The VS screen, the coin flip, the stage intro (name, par, yards, wind) each appear and
      can be skipped with a click.
- [ ] The first player is called up by name. Hit (real balls or test swings). The turn passes
      to whoever is farther from the hole.
- [ ] Arm a power-up ball with a number key before one shot: the ball on the tee changes
      look and the shot behaves differently.
- [ ] Finish the hole (the CONCEDE tab under the header ends it if you are in a hurry). The
      winner screen appears with confetti and REMATCH / NEW MATCH / EXIT.

## 8. Quit, relaunch, uninstall (1 min)

- [ ] Main menu, **QUIT**. The window closes at once and nothing is left running
      (Task Manager shows no "Sim Clash").
- [ ] Start it again: the players you made are still there.
- [ ] Quit. Windows Settings, Apps, **Sim Clash**, Uninstall. No administrator prompt.
- [ ] Both shortcuts are gone and the app is gone from the list.
- [ ] `%APPDATA%\Sim Clash` (paste that into File Explorer's address bar) is **still
      there**, with `data` and `logs` inside: the player's data survives an uninstall.
- [ ] `%LOCALAPPDATA%\Programs\sim-clash` and `%LOCALAPPDATA%\sim-clash-updater` do not
      exist.
- [ ] Install again: the players and coins from before are back.

## If something went wrong

Send `%APPDATA%\Sim Clash\logs\game.log` with your notes. It holds what the game printed,
including why it could not start.

## What the machine already checked (so you need not)

On the build PC, without ever opening the game window: the installer was run silently into
a scratch folder; the installed files, the two shortcuts and the uninstall entry were
checked; the installed app's own runtime started the game server in a windowless mode on
private ports with an empty data folder, installed the stages and the two sky photos, served
the game and played a test shot; the uninstaller was run silently and left nothing behind.
(The game's pages were also looked at in a browser from a source server: the menus, the
stages, the HUD at 1600 x 900 and 1280 x 720. That is the same page, not the installed
window.) What that cannot show
is everything on this page: SmartScreen, the firewall prompt, the window, the picture, the
sound, and whether it is any fun.
