/**
 * The subtitle overlay's own tiny page - a self-contained data: URL, same
 * trick as errorPage.ts/newTabPage.ts. Deliberately not a full renderer
 * (no preload/contextBridge/IPC): this view only ever displays text pushed
 * to it by WindowManager via `executeJavaScript` calling `setSubtitleText`
 * below - it never needs to call back into main, so there's nothing an
 * IPC bridge would buy it. Styled like real captions (not the app's own
 * paper/ink theme) since it's meant to read as part of the video, not
 * part of the browser chrome.
 */
export function buildSubtitleOverlayUrl(): string {
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        height: 100%;
        background: transparent;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        overflow: hidden;
      }
      #subtitle {
        position: relative;
        margin-bottom: 26px;
        padding: 11px 22px;
        max-width: 78%;
        border-radius: 10px;
        background: rgba(17, 15, 13, 0.68);
        backdrop-filter: blur(16px) saturate(150%);
        -webkit-backdrop-filter: blur(16px) saturate(150%);
        box-shadow:
          0 8px 24px rgba(0, 0, 0, 0.35),
          inset 0 0 0 1px rgba(255, 255, 255, 0.08);
        color: #f6f1ea;
        font-family: -apple-system, 'Segoe UI', sans-serif;
        font-size: 21px;
        font-weight: 500;
        letter-spacing: 0.1px;
        line-height: 1.45;
        text-align: center;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
        opacity: 0;
        transform: translateY(8px);
        transition:
          opacity 160ms ease-in,
          transform 160ms ease-in;
      }
      /* A thin warm hairline on the top edge - the one deliberate accent,
         kept subtle since this sits over arbitrary video content and has
         to stay legible, not decorative, above all else. */
      #subtitle::before {
        content: '';
        position: absolute;
        top: 0;
        left: 14%;
        right: 14%;
        height: 1.5px;
        border-radius: 1px;
        background: linear-gradient(90deg, transparent, rgba(232, 184, 84, 0.55), transparent);
      }
      #subtitle.visible {
        opacity: 1;
        transform: translateY(0);
        transition:
          opacity 240ms cubic-bezier(0.16, 1, 0.3, 1),
          transform 240ms cubic-bezier(0.16, 1, 0.3, 1);
      }
      @media (prefers-reduced-motion: reduce) {
        #subtitle {
          transform: none;
          transition: opacity 160ms ease-in-out;
        }
        #subtitle.visible {
          transform: none;
          transition: opacity 160ms ease-in-out;
        }
      }
    </style>
  </head>
  <body>
    <div id="subtitle"></div>
    <script>
      window.setSubtitleText = function (text) {
        const el = document.getElementById('subtitle');
        if (!text) {
          el.classList.remove('visible');
          return;
        }
        el.textContent = text;
        el.classList.add('visible');
      };
    </script>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

/** Escapes text for safe embedding in a JS string literal passed to
 * executeJavaScript - text comes from whisper.cpp's transcription and then
 * the chosen agent's translation, both effectively untrusted input. */
export function buildSetSubtitleTextScript(text: string | null): string {
  const encoded = JSON.stringify(text ?? '');
  return `window.setSubtitleText(${encoded});`;
}
