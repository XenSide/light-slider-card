// Brightness slider for one light: the whole card is the slider, with a waving liquid surface.
// orientation: vertical (default, fills bottom->top) | horizontal (fills left->right).
// Drag = brightness, tap = toggle, tune button = more-info (colour/temperature).

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const pctFromPoint = (e, rect, horizontal) => Math.round(100 * clamp01(horizontal
  ? (e.clientX - rect.left) / rect.width
  : (rect.bottom - e.clientY) / rect.height));
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// one wavelength (100 x 12), used as a repeating mask so the wave takes the light's colour
const WAVE_H = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='12'%3E%3Cpath d='M0 6 Q25 0 50 6 T100 6 V12 H0 Z'/%3E%3C/svg%3E")`;
const WAVE_V = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='100'%3E%3Cpath d='M6 0 Q0 25 6 50 T6 100 H0 V0 Z'/%3E%3C/svg%3E")`;

class LightSliderCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity || !config.entity.startsWith("light.")) {
      throw new Error("entity must be a light");
    }
    this._config = config;
    this._horizontal = config.orientation === "horizontal";
    if (this._hass) this._render(); // the UI editor calls setConfig again on the live card
  }

  set hass(hass) {
    this._hass = hass;
    if (!this.shadowRoot) this._build();
    if (!this._drag) this._render();
  }

  getCardSize() { return this._horizontal ? 2 : 4; }
  getGridOptions() {
    return this._horizontal
      ? { columns: 12, rows: 2, min_rows: 1, min_columns: 6 }
      : { columns: 6, rows: 4, min_rows: 2, min_columns: 3 };
  }
  static getStubConfig(hass) {
    const entity = Object.keys(hass?.states || {}).find((e) => e.startsWith("light.")) || "light.example";
    return { entity, orientation: "vertical", wave: true };
  }

  // visual editor (Edit dashboard -> card); HA builds the form from this schema
  static getConfigForm() {
    const labels = { entity: "Luce", name: "Nome", orientation: "Orientamento", wave: "Onda animata" };
    return {
      schema: [
        { name: "entity", required: true, selector: { entity: { domain: "light" } } },
        { name: "name", selector: { text: {} } },
        { name: "orientation", selector: { select: { mode: "dropdown", options: [
          { value: "vertical", label: "Verticale" },
          { value: "horizontal", label: "Orizzontale" },
        ] } } },
        { name: "wave", selector: { boolean: {} } },
      ],
      computeLabel: (s) => labels[s.name],
    };
  }

  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: block; height: 100%; }
        ha-card {
          position: relative; height: 100%; min-height: 56px; overflow: hidden;
          cursor: pointer; touch-action: none; user-select: none;
          --c: 158, 161, 184; --glow: 0; --wave-speed: 4s;
          /* opaque surface colour, so fill and wave can overlap without a visible seam */
          --surface: color-mix(in srgb, rgb(var(--c)) 82%, #141827);
          transition: transform .35s cubic-bezier(.34, 1.56, .64, 1);
        }
        ha-card.pressed { transform: scale(.96); transition-duration: .12s; }
        ha-card.drag { --wave-speed: 1.2s; }
        .fill {
          position: absolute; left: 0; bottom: 0; right: 0; height: 0;
          background: linear-gradient(to top, rgb(var(--c)), var(--surface));
          transition: height .55s cubic-bezier(.34, 1.3, .64, 1), width .55s cubic-bezier(.34, 1.3, .64, 1);
        }
        .h .fill {
          top: 0; right: auto; height: auto; width: 0;
          background: linear-gradient(to right, rgb(var(--c)), var(--surface));
        }
        ha-card.drag .fill { transition: none; }
        .wave {
          /* 1px overlap with the fill so no gap can open between them */
          position: absolute; left: 0; right: -100px; top: -11px; height: 12px;
          background: var(--surface);
          -webkit-mask: ${WAVE_H} repeat-x 0 0 / 100px 12px; mask: ${WAVE_H} repeat-x 0 0 / 100px 12px;
          animation: wave-x var(--wave-speed) linear infinite;
          transition: opacity .3s;
        }
        /* back wave sits higher, so its box reaches down into the fill (wave on top, solid below)
           or a gap opens under the front wave's troughs */
        .wave.back {
          opacity: .45; top: -16px; height: 17px;
          -webkit-mask: ${WAVE_H} repeat-x 0 0 / 100px 12px, linear-gradient(#000 0 0) no-repeat 0 12px / 100% 100%;
          mask: ${WAVE_H} repeat-x 0 0 / 100px 12px, linear-gradient(#000 0 0) no-repeat 0 12px / 100% 100%;
          animation-duration: calc(var(--wave-speed) * 1.6); animation-direction: reverse;
        }
        .h .wave {
          left: auto; right: -11px; top: -100px; bottom: 0; width: 12px; height: auto;
          -webkit-mask: ${WAVE_V} repeat-y 0 0 / 12px 100px; mask: ${WAVE_V} repeat-y 0 0 / 12px 100px;
          animation-name: wave-y;
        }
        .h .wave.back {
          top: -100px; right: -16px; width: 17px;
          -webkit-mask: ${WAVE_V} repeat-y 100% 0 / 12px 100px, linear-gradient(#000 0 0) no-repeat 0 0 / calc(100% - 12px) 100%;
          mask: ${WAVE_V} repeat-y 100% 0 / 12px 100px, linear-gradient(#000 0 0) no-repeat 0 0 / calc(100% - 12px) 100%;
        }
        .fill.empty .wave { opacity: 0; }
        .nowave .wave { display: none; }
        @keyframes wave-x { to { transform: translateX(-100px); } }
        @keyframes wave-y { to { transform: translateY(100px); } }
        .content {
          position: relative; height: 100%; box-sizing: border-box; padding: 14px;
          display: flex; flex-direction: column; justify-content: space-between;
          color: var(--primary-text-color);
        }
        .h .content { flex-direction: row; align-items: center; justify-content: flex-start; gap: 14px; }
        .h .top { display: contents; }
        .h .bottom { order: 1; }
        .h .tune { order: 2; margin-left: auto; }
        .top { display: flex; justify-content: space-between; align-items: flex-start; }
        .icon, .tune, .bottom { transition: color .2s, background .3s, box-shadow .5s; }
        .icon {
          width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center;
          background: rgba(var(--c), .2); color: rgb(var(--c));
          box-shadow: 0 0 calc(var(--glow) * 30px) rgba(var(--c), calc(var(--glow) * .7));
        }
        .dark { color: #141827; }
        .icon.dark { background: rgba(20, 24, 39, .12); color: #141827; }
        .tune {
          width: 36px; height: 36px; border-radius: 12px; display: grid; place-items: center;
          background: rgba(127, 127, 127, .15); color: var(--primary-text-color); border: 0; cursor: pointer;
          --mdc-icon-size: 20px;
        }
        .tune.dark { color: #141827; }
        .icon.pop { animation: pop .6s cubic-bezier(.34, 1.56, .64, 1); }
        @keyframes pop {
          0% { transform: scale(.7) rotate(-12deg); }
          60% { transform: scale(1.15) rotate(4deg); }
          100% { transform: scale(1) rotate(0); }
        }
        .name { font-weight: 600; font-size: 15px; line-height: 1.3; }
        .pct { font-size: 28px; font-weight: 600; line-height: 1.1; }
        .off .pct { font-size: 15px; font-weight: 500; opacity: .7; }
        @media (prefers-reduced-motion: reduce) {
          *, *::before { transition: none !important; animation: none !important; }
        }
      </style>
      <ha-card>
        <div class="fill"><div class="wave back"></div><div class="wave"></div></div>
        <div class="content">
          <div class="top">
            <div class="icon"><ha-icon></ha-icon></div>
            <button class="tune" aria-label="Dettagli"><ha-icon icon="mdi:tune-variant"></ha-icon></button>
          </div>
          <div class="bottom"><div class="pct"></div><div class="name"></div></div>
        </div>
      </ha-card>`;
    this._card = root.querySelector("ha-card");
    this._fill = root.querySelector(".fill");
    this._card.addEventListener("pointerdown", (e) => this._down(e));
    this._card.addEventListener("pointermove", (e) => this._move(e));
    this._card.addEventListener("pointerup", (e) => this._up(e));
    this._card.addEventListener("pointercancel", () => {
      this._drag = null;
      this._card.classList.remove("drag", "pressed");
      this._render();
    });
    this._card.addEventListener("pointerleave", () => this._card.classList.remove("pressed"));
    // the text colour depends on where things sit, so recheck once the card has a size
    new ResizeObserver(() => { if (!this._drag) this._render(); }).observe(this._card);
    root.querySelector(".icon").addEventListener("animationend", (e) =>
      e.currentTarget.classList.remove("pop"));
    root.querySelector(".tune").addEventListener("pointerdown", (e) => e.stopPropagation());
    root.querySelector(".tune").addEventListener("click", () =>
      this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId: this._config.entity }, bubbles: true, composed: true })));
  }

  _state() { return this._hass.states[this._config.entity]; }

  _render(dragPct) {
    const sr = this.shadowRoot;
    this._card.classList.toggle("h", this._horizontal);
    this._card.classList.toggle("nowave", this._config.wave === false); // missing = on
    const st = this._state();
    const name = this._config.name || st?.attributes.friendly_name || this._config.entity;
    const on = st?.state === "on";
    const pct = dragPct ?? (on ? Math.max(1, Math.round((st.attributes.brightness || 255) / 2.55)) : 0);
    const rgb = st?.attributes.rgb_color;
    this._card.style.setProperty("--c", on && rgb ? rgb.join(",") : "158,161,184");
    this._card.style.setProperty("--glow", pct / 100);
    // clear the other axis: orientation can change on a live card from the editor
    this._fill.style.width = this._horizontal ? `${pct}%` : "";
    this._fill.style.height = this._horizontal ? "" : `${pct}%`;
    this._fill.classList.toggle("empty", pct === 0);
    // dark text/icons on anything whose centre the fill has reached
    const reach = this._horizontal
      ? this._card.clientWidth * pct / 100
      : this._card.clientHeight * (1 - pct / 100);
    const c = this._card.getBoundingClientRect();
    for (const el of c.width ? sr.querySelectorAll(".icon, .tune, .bottom") : []) {
      const r = el.getBoundingClientRect();
      const mid = this._horizontal ? r.left - c.left + r.width / 2 : r.top - c.top + r.height / 2;
      el.classList.toggle("dark", pct > 0 && (this._horizontal ? reach >= mid : reach <= mid));
    }
    sr.querySelector(".bottom").classList.toggle("off", pct === 0);
    if (on && this._wasOn === false) sr.querySelector(".icon").classList.add("pop");
    if (st) this._wasOn = on;
    sr.querySelector(".icon ha-icon").icon =
      st?.attributes.icon || (on ? "mdi:lightbulb-on" : "mdi:lightbulb-outline");
    sr.querySelector(".name").textContent = name;
    if (!st || st.state === "unavailable") this._setPct(null);
    else this._countTo(pct, dragPct !== undefined);
  }

  _setPct(v) {
    this._shown = v;
    this.shadowRoot.querySelector(".pct").textContent =
      v === null ? "Non disponibile" : v ? `${v}%` : "Spenta";
  }

  // the percentage counts to its new value instead of jumping (except while dragging)
  _countTo(target, instant) {
    cancelAnimationFrame(this._raf);
    const from = this._shown;
    if (instant || reducedMotion.matches || from == null || from === target) return this._setPct(target);
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 450);
      this._setPct(Math.round(from + (target - from) * (1 - (1 - k) ** 3)));
      if (k < 1) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  _down(e) {
    this._drag = { x: e.clientX, y: e.clientY, moved: false };
    this._card.classList.add("pressed");
    this._card.setPointerCapture(e.pointerId);
  }

  _move(e) {
    if (!this._drag) return;
    const delta = this._horizontal ? e.clientX - this._drag.x : e.clientY - this._drag.y;
    if (!this._drag.moved && Math.abs(delta) < 6) return;
    this._drag.moved = true;
    // drop the press scale before measuring, so pctFromPoint sees the real card size
    this._card.classList.remove("pressed");
    this._card.classList.add("drag");
    this._drag.pct = pctFromPoint(e, this._card.getBoundingClientRect(), this._horizontal);
    this._render(this._drag.pct);
  }

  _up() {
    const d = this._drag;
    this._drag = null;
    this._card.classList.remove("drag", "pressed");
    if (!d) return;
    const entity_id = this._config.entity;
    if (!d.moved) {
      this._hass.callService("light", "toggle", { entity_id });
    } else if (d.pct === 0) {
      this._hass.callService("light", "turn_off", { entity_id });
    } else {
      this._hass.callService("light", "turn_on", { entity_id, brightness_pct: d.pct });
    }
    this._render(d.moved ? d.pct : undefined);
  }
}

customElements.define("light-slider-card", LightSliderCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "light-slider-card",
  name: "Light slider card",
  description: "Slider luce a tutta card, verticale o orizzontale",
});
