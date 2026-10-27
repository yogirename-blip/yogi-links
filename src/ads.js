// ============================================================
//  AD SETTINGS  -  EDIT THIS FILE
// ============================================================
// How many seconds the visitor must wait on each page before "Continue" works.
const WAIT_SECONDS = 8;

// Paste your ad network's code between the backticks (Adsterra / Monetag etc).
// Leave empty `` to show a grey "Ad space" test box instead.

// மேல இருக்கிற ad
const AD_TOP = `
PASTE_YOUR_TOP_AD_CODE_HERE
`;

// நடுவுல இருக்கிற ad
const AD_MIDDLE = `
PASTE_YOUR_MIDDLE_AD_CODE_HERE
`;

// கீழ இருக்கிற ad
const AD_BOTTOM = `
PASTE_YOUR_BOTTOM_AD_CODE_HERE
`;

module.exports = { WAIT_SECONDS, AD_TOP, AD_MIDDLE, AD_BOTTOM };
