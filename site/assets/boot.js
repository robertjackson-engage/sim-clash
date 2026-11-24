// Runs before the page is drawn: marks the page as scripted, so the stylesheet can lay the
// script-driven parts out (route overlays, before / after sliders) without a flash.
document.documentElement.className += ' js';
