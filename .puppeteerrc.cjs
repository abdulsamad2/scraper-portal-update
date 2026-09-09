/**
 * Puppeteer configuration.
 *
 * whatsapp-web.js depends on puppeteer, whose install script otherwise downloads its own
 * ~350MB Chromium. We never run that copy: locally the app drives system Chrome, and the
 * container installs Alpine's chromium package — both wired up via PUPPETEER_EXECUTABLE_PATH.
 *
 * Skipping it also removes a real failure mode. An interrupted download leaves the version
 * folder under ~/.cache/puppeteer present but EMPTY; puppeteer then treats the browser as
 * already installed, every provider fails, and `npm install` aborts for the whole project —
 * not just for this one package. That is what broke this install.
 *
 * This file, not .npmrc, is the mechanism that works: puppeteer v20+ reads its config from
 * .puppeteerrc.cjs. The old `puppeteer_skip_download` npmrc key is silently ignored (and npm
 * now warns it is an unknown project config).
 */
module.exports = {
  skipDownload: true,
};
