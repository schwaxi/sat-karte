// sat-karte v1.0.1
// Einzeln installierbares Modul (Home Assistant Marketplace / HACS, Kategorie Dashboard).
window.customCards = window.customCards || [];
window.customCardFeatures = window.customCardFeatures || [];
// Eigener Block: Namen bleiben lokal, auch wenn mehrere Karten zusammen geladen werden.
{
// ---------------------------------------------------------------------------
// Sat-Karte: Enigma2-/Vu+-Receiver (Ein/Aus, laufender Sender und Sendung, Lieblingssender als Tasten,
// Kanal +/-, Auswahl aller Sender). Optional schaltet sie den Fernseher auf den passenden Eingang.
//
//   type: custom:sat-karte
//   entity: media_player.vu_uno_4k
//   name: Sat-Receiver                     # optional
//   sender: [ORF1 HD, ORF2N HD, ServusTV HD Oesterreich]   # optional, Lieblingssender (Namen wie in der Senderliste)
//   tv: media_player.lg_webos_tv_uj675v    # optional, Fernseher
//   tv_eingang: HDMI-1                     # optional, Eingang des Fernsehers fuer den Sat-Receiver
//   tasten: rest_command.vu_taste          # optional, Fernbedienung zum Aufklappen. Dienst bekommt die Tastennummer als 'code'
//                                          # (OpenWebif: http://<receiver>/api/remotecontrol?command={{ code }}).
//                                          # Die Fernbedienung erscheint erst, wenn es den Dienst in HA gibt.

const TYPE18 = "sat-karte";

class SatKarte extends HTMLElement {
  setConfig(c) {
    if (!c?.entity) throw new Error("entity (media_player.*) fehlt");
    this._config = { sender: [], ...c };
    this._offen = false;
    this._render();
  }

  set hass(hass) { this._hass = hass; this._update(); }

  _s(id) { return id ? this._hass?.states[id] : null; }
  _dienst(d, s, daten) { return this._hass.callService(d, s, daten); }
  _an() { const s = this._s(this._config.entity); return !!s && !["off", "unavailable", "unknown", "standby"].includes(s.state); }

  // Echte Sender (ohne Trennzeilen der Bouquets)
  _liste() {
    const l = this._s(this._config.entity)?.attributes.source_list || [];
    const trenner = /^(\.|<n\/a>|&lt;n\/a&gt;|nachrichten|diverse|-+)$/i;
    return l.filter((x) => x && !trenner.test(String(x).trim()));
  }

  // Fernseher auf den Sat-Eingang stellen (nur wenn er an ist)
  _tvEingang() {
    const c = this._config, tv = this._s(c.tv);
    if (tv && tv.state === "on" && c.tv_eingang && tv.attributes.source !== c.tv_eingang)
      this._dienst("media_player", "select_source", { entity_id: c.tv, source: c.tv_eingang }).catch(() => {});
  }

  async _einschalten() {
    if (!this._an()) {
      await this._dienst("media_player", "turn_on", { entity_id: this._config.entity });
      for (let i = 0; i < 20 && !this._an(); i++) await new Promise((ok) => setTimeout(ok, 500));
    }
    this._tvEingang();
  }

  async _sender(q) {
    await this._einschalten();
    await this._dienst("media_player", "select_source", { entity_id: this._config.entity, source: q });
  }

  // Fernbedienung: Dienst aus 'tasten' (z.B. rest_command.vu_taste), nur wenn er in HA existiert
  _tastenDienst() {
    const [d, s] = String(this._config.tasten || "").split(".");
    return d && s && this._hass?.services?.[d]?.[s] ? [d, s] : null;
  }
  _taste(code) {
    const t = this._tastenDienst();
    if (t) this._dienst(t[0], t[1], { code: Number(code) }).catch(() => {});
  }

  _render() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 14px 16px; box-sizing: border-box; }
        .kopf { display: flex; align-items: center; gap: 12px; }
        .kopf .ic { --mdc-icon-size: 28px; color: var(--state-icon-color, #44739e); }
        .kopf.an .ic { color: var(--state-media_player-active-color, var(--amber-color, #ffc107)); }
        .titel { flex: 1; min-width: 0; }
        .name { font-size: 16px; font-weight: 500; color: var(--primary-text-color); }
        .status { font-size: 13px; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        button { font: inherit; cursor: pointer; border: none; background: none; color: var(--primary-text-color); }
        .rund { width: 42px; height: 42px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
          background: var(--secondary-background-color, rgba(127,127,127,.15)); flex: none; }
        .rund ha-icon { --mdc-icon-size: 22px; }
        .power.an { background: var(--success-color, #43a047); color: #fff; }
        .jetzt { display: none; margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: var(--secondary-background-color, rgba(127,127,127,.1)); }
        .jetzt.an { display: block; }
        .sender-name { font-size: 15px; font-weight: 500; color: var(--primary-text-color); }
        .sendung { font-size: 13px; color: var(--secondary-text-color); margin-top: 2px; }
        .balken { height: 4px; border-radius: 2px; background: var(--divider-color, #444); margin-top: 8px; overflow: hidden; display: none; }
        .balken i { display: block; height: 100%; background: var(--primary-color); }
        .favs { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px; margin-top: 12px; }
        .favs:empty { display: none; }
        .f { padding: 10px 6px; border-radius: 12px; font-size: 13px; line-height: 1.2; text-align: center;
          background: var(--secondary-background-color, rgba(127,127,127,.12)); border: 2px solid transparent; }
        .f.aktiv { border-color: var(--primary-color); background: color-mix(in srgb, var(--primary-color) 18%, transparent); }
        .zeile { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
        select { flex: 1; min-width: 0; font: inherit; font-size: 14px; padding: 8px; border-radius: 8px; color: var(--primary-text-color);
          background: var(--card-background-color, #1c1c1c); border: 1px solid var(--divider-color, #555); }
        .klein { width: 38px; height: 38px; }
        .fb-auf { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 12px; padding: 6px;
          font-size: 13px; color: var(--secondary-text-color); border-top: 1px solid var(--divider-color, #444); }
        .fb-auf ha-icon { --mdc-icon-size: 18px; transition: transform .2s; }
        .fb-auf.offen ha-icon { transform: rotate(180deg); }
        .fb { display: none; margin-top: 8px; }
        .fb.offen { display: block; }
        .fb-oben { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
        .kreuz { display: grid; grid-template-columns: repeat(3, 48px); grid-template-rows: repeat(3, 48px); gap: 4px; }
        .kreuz button { border-radius: 12px; background: var(--secondary-background-color, rgba(127,127,127,.15)); display: flex; align-items: center; justify-content: center; }
        .kreuz button.ok { border-radius: 50%; background: var(--primary-color); color: var(--text-primary-color, #fff); font-weight: 500; }
        .kreuz ha-icon { --mdc-icon-size: 24px; }
        .spalte { display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .farben { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 12px; }
        .farben button { height: 14px; border-radius: 7px; }
        .reihe { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 10px; }
        .reihe button, .ziffern button { height: 38px; border-radius: 10px; font-size: 15px; display: flex; align-items: center; justify-content: center;
          background: var(--secondary-background-color, rgba(127,127,127,.15)); }
        .reihe ha-icon { --mdc-icon-size: 20px; }
        .ziffern { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 10px; }
      </style>
      <ha-card>
        <div class="kopf">
          <ha-icon class="ic" icon="mdi:satellite-variant"></ha-icon>
          <div class="titel"><div class="name"></div><div class="status"></div></div>
          <button class="rund power" title="Ein / Aus"><ha-icon icon="mdi:power"></ha-icon></button>
        </div>
        <div class="jetzt"><div class="sender-name"></div><div class="sendung"></div><div class="balken"><i></i></div></div>
        <div class="favs"></div>
        <div class="zeile">
          <button class="rund klein ab" title="Kanal zurück"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
          <select class="alle"></select>
          <button class="rund klein auf" title="Kanal weiter"><ha-icon icon="mdi:chevron-up"></ha-icon></button>
        </div>
        <button class="fb-auf"><span>Fernbedienung</span><ha-icon icon="mdi:chevron-down"></ha-icon></button>
        <div class="fb">
          <div class="fb-oben">
            <div class="spalte">
              <button class="rund" data-k="174" title="Exit / Zurück"><ha-icon icon="mdi:arrow-u-left-top"></ha-icon></button>
              <button class="rund" data-k="139" title="Menü"><ha-icon icon="mdi:menu"></ha-icon></button>
              <button class="rund" data-k="358" title="EPG / Info"><ha-icon icon="mdi:television-guide"></ha-icon></button>
            </div>
            <div class="kreuz">
              <span></span><button data-k="103" title="Hoch"><ha-icon icon="mdi:chevron-up"></ha-icon></button><span></span>
              <button data-k="105" title="Links"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
              <button class="ok" data-k="352">OK</button>
              <button data-k="106" title="Rechts"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
              <span></span><button data-k="108" title="Runter"><ha-icon icon="mdi:chevron-down"></ha-icon></button><span></span>
            </div>
            <div class="spalte">
              <button class="rund" data-k="115" title="Lauter"><ha-icon icon="mdi:volume-plus"></ha-icon></button>
              <button class="rund" data-k="113" title="Stumm"><ha-icon icon="mdi:volume-off"></ha-icon></button>
              <button class="rund" data-k="114" title="Leiser"><ha-icon icon="mdi:volume-minus"></ha-icon></button>
            </div>
          </div>
          <div class="farben">
            <button data-k="398" title="Rot" style="background:#e53935"></button>
            <button data-k="399" title="Grün" style="background:#43a047"></button>
            <button data-k="400" title="Gelb" style="background:#fdd835"></button>
            <button data-k="401" title="Blau" style="background:#1e88e5"></button>
          </div>
          <div class="reihe">
            <button data-k="168" title="Zurückspulen"><ha-icon icon="mdi:rewind"></ha-icon></button>
            <button data-k="164" title="Wiedergabe / Pause"><ha-icon icon="mdi:play-pause"></ha-icon></button>
            <button data-k="128" title="Stopp"><ha-icon icon="mdi:stop"></ha-icon></button>
            <button data-k="208" title="Vorspulen"><ha-icon icon="mdi:fast-forward"></ha-icon></button>
            <button data-k="388" title="Teletext"><ha-icon icon="mdi:card-text-outline"></ha-icon></button>
          </div>
          <div class="ziffern">
            ${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k, i) => `<button data-k="${k}">${(i + 1) % 10}</button>`).join("")}
          </div>
        </div>
      </ha-card>`;
    const r = this.shadowRoot, e = () => ({ entity_id: this._config.entity });
    r.querySelector(".power").addEventListener("click", () => (this._an() ? this._dienst("media_player", "turn_off", e()) : this._einschalten()));
    r.querySelector(".ab").addEventListener("click", async () => { await this._einschalten(); this._dienst("media_player", "media_previous_track", e()); });
    r.querySelector(".auf").addEventListener("click", async () => { await this._einschalten(); this._dienst("media_player", "media_next_track", e()); });
    r.querySelector(".alle").addEventListener("change", (ev) => { if (ev.target.value) this._sender(ev.target.value); });
    r.querySelector(".fb-auf").addEventListener("click", () => {
      this._offen = !this._offen;
      r.querySelector(".fb-auf").classList.toggle("offen", this._offen);
      r.querySelector(".fb").classList.toggle("offen", this._offen);
    });
    r.querySelectorAll(".fb [data-k]").forEach((b) => b.addEventListener("click", () => this._taste(b.dataset.k)));
    this._favSchluessel = null;
    this._update();
  }

  _update() {
    const r = this.shadowRoot, c = this._config;
    if (!r || !c || !this._hass) return;
    const s = this._s(c.entity), a = s?.attributes || {}, an = this._an();
    const sender = an ? a.source || a.media_channel || "" : "";
    r.querySelector(".kopf").classList.toggle("an", an);
    r.querySelector(".power").classList.toggle("an", an);
    r.querySelector(".name").textContent = c.name || a.friendly_name || c.entity;
    r.querySelector(".status").textContent = !s ? "nicht gefunden" : s.state === "unavailable" ? "nicht erreichbar"
      : !an ? "Standby" : sender || "An";

    // Laufende Sendung
    const titel = an ? a.media_title : "";
    r.querySelector(".jetzt").classList.toggle("an", an && !!(sender || titel));
    r.querySelector(".sender-name").textContent = sender;
    r.querySelector(".sendung").textContent = titel && titel !== sender ? titel : "";
    const start = a.media_start_time ? Date.parse(a.media_start_time) : null, ende = a.media_end_time ? Date.parse(a.media_end_time) : null;
    const balken = r.querySelector(".balken");
    if (an && start && ende && ende > start) {
      balken.style.display = "block";
      balken.querySelector("i").style.width = `${Math.max(0, Math.min(100, (Date.now() - start) / (ende - start) * 100))}%`;
    } else balken.style.display = "none";

    // Fernbedienung nur, wenn der Tasten-Dienst existiert
    const fb = !!this._tastenDienst();
    r.querySelector(".fb-auf").style.display = fb ? "" : "none";
    if (!fb) r.querySelector(".fb").classList.remove("offen");

    // Lieblingssender
    const favs = (c.sender || []).map((x) => (typeof x === "string" ? { quelle: x } : x)).filter((x) => x && x.quelle);
    const box = r.querySelector(".favs"), k = JSON.stringify(favs);
    if (k !== this._favSchluessel) {
      this._favSchluessel = k;
      box.innerHTML = "";
      for (const f of favs) {
        const b = document.createElement("button");
        b.className = "f"; b.dataset.q = f.quelle;
        b.textContent = f.name || f.quelle.replace(/ (HD|Austria|Oesterreich|Österreich)\b/gi, "").trim();
        b.addEventListener("click", () => this._sender(f.quelle));
        box.appendChild(b);
      }
    }
    box.querySelectorAll(".f").forEach((b) => b.classList.toggle("aktiv", an && b.dataset.q === sender));

    // Alle Sender
    const liste = this._liste(), sel = r.querySelector(".alle"), ks = JSON.stringify([liste, sender]);
    if (sel.dataset.k !== ks) {
      sel.dataset.k = ks;
      sel.innerHTML = `<option value="">${sender && liste.includes(sender) ? "" : "Sender wählen …"}</option>`
        + liste.map((x) => `<option value="${x.replace(/"/g, "&quot;")}"${x === sender ? " selected" : ""}>${x}</option>`).join("");
    }
  }

  getCardSize() { return 4; }
  getGridOptions() { return { columns: 12, rows: "auto" }; }

  static getConfigForm() {
    return {
      schema: [
        { name: "entity", required: true, selector: { entity: { domain: "media_player" } } },
        { name: "name", selector: { text: {} } },
        { name: "sender", selector: { object: {} } },
        { type: "grid", name: "", schema: [
          { name: "tv", selector: { entity: { domain: "media_player" } } },
          { name: "tv_eingang", selector: { text: {} } },
        ] },
        { name: "tasten", selector: { text: {} } },
      ],
      computeLabel: (s) => ({ entity: "Sat-Receiver", name: "Name", sender: "Lieblingssender", tasten: "Dienst für die Fernbedienung (z. B. rest_command.vu_taste)",
        tv: "Fernseher (optional)", tv_eingang: "Eingang am Fernseher, z. B. HDMI-1" }[s.name] || s.name),
      computeHelper: (s) => (s.name === "sender" ? "Liste der Sendernamen wie in der Senderliste, z. B. - ORF1 HD" : undefined),
    };
  }

  static getStubConfig(hass) {
    const ids = Object.keys(hass?.states || {}).filter((id) => id.startsWith("media_player."));
    return { entity: ids.find((id) => /vu|enigma|dreambox|sat/i.test(id)) || ids[0] || "" };
  }
}

if (!customElements.get(TYPE18)) customElements.define(TYPE18, SatKarte);
if (!window.customCards.some((c) => c.type === TYPE18)) {
  window.customCards.push({ type: TYPE18, name: "Sat-Karte", description: "Sat-Receiver (Enigma2/Vu+): laufender Sender, Lieblingssender, Kanal +/- und Senderliste", preview: true });
}
}

console.info("%c sat-karte %c v1.0.0 ", "color:#fff;background:#03a9f4;font-weight:700", "color:#03a9f4");
