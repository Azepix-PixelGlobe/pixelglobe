/**
 * Nora Tour — copy + step definitions (TR / EN)
 * ---------------------------------------------
 * Every step is a plain object, the UI wiring lives in NoraTour.jsx.
 *
 *   id         unique key (used for persisted progress)
 *   title      bold headline in the tooltip card
 *   text       body copy, typed out character by character
 *   target     array of CSS selectors — first one found gets the spotlight
 *   placement  'auto' | 'center' | 'left' | 'right' | 'top' | 'bottom'
 *   hint       'top' | 'bottom' | 'inside' — where the "tap here" bubble sits
 *   watch      any of { click:[], state:[], dom:[], pixel:true } — as soon as
 *              one of them happens the tour continues on its own
 *   onEnter    'openSettings' | 'ensureSettings' | 'ensureUserArea'
 *              | 'ensureMenu' | 'closeWindows'
 *   onNext     action used when the player presses Next instead of doing it
 *   nextLabel  override for the primary button
 */

export const TOUR_KEY = 'pg_nora_tour_v1';

export const GATE = {
  tr: {
    hello: 'Selam ben Nora, sana oyunu öğreteceğim!',
    helloSub: "Hey, I'm Nora — I'll teach you the game!",
    ask: 'İlk hangi dil ile konuşmamı istersin?',
    askSub: 'Which language should I speak first?',
    tr: 'Türkçe Konuş',
    en: 'Speak English',
    later: 'Şimdi değil',
    meta: '13 adımlık hızlı tur · istediğin an atlayabilirsin',
  },
  en: {
    hello: "Hey, I'm Nora — I'll teach you the game!",
    helloSub: 'Selam ben Nora, sana oyunu öğreteceğim!',
    ask: 'Which language should I speak first?',
    askSub: 'İlk hangi dil ile konuşmamı istersin?',
    tr: 'Türkçe Konuş',
    en: 'Speak English',
    later: 'Not now',
    meta: 'A 13 step quick tour · you can skip it any time',
  },
};

export const UI_TEXT = {
  tr: {
    name: 'Nora',
    skip: 'Turu atla',
    back: 'Geri',
    next: 'İleri',
    done: 'Bitti',
    tapHere: 'buraya dokun',
    resume: 'Rehberi sürdür',
    resumeShort: 'Rehber',
    complete: 'Rehber tamamlandı — iyi boyamalar! 🎉',
    autoNote: 'Sen yapınca kendim devam ederim.',
  },
  en: {
    name: 'Nora',
    skip: 'Skip tour',
    back: 'Back',
    next: 'Next',
    done: 'Done',
    tapHere: 'tap here',
    resume: 'Continue the tour',
    resumeShort: 'Tour',
    complete: 'Tour complete — have fun painting! 🎉',
    autoNote: "I'll continue on my own once you do it.",
  },
};

/* ---------------------------------------------------------------- helpers */

// Slugs used by TopButtons / Palette / windows in this codebase.
const SEL = {
  paletteButton: ['#palselbutton'],
  paletteBox: ['#palettebox'],
  menuToggle: ['#topbtnrow .topbtn', '#topbtnbar .topbtn'],
  menuColumn: ['#topbtncol.open'],
  chatButton: ['#chatbutton'],
  pencilButton: ['#pencilbutton'],
  stockBox: ['.cooldownbox', '.onlinebox', '#canvas-controls', '#app canvas', '.viewport'],
  canvas: ['.viewport', '#app canvas', 'canvas'],
  settingsWindow: ['#wm .window.SETTINGS.show', '#wm .window.SETTINGS'],
  userAreaWindow: ['#wm .window.USERAREA.show', '#wm .window.USERAREA'],
  menuColumnTarget: ['#topbtncol'],
};

const COPY_EN = {
  steps: [
    {
      title: "Hey, I'm Nora",
      text: "I look after this canvas. Let's do a quick round — on each step I'll show you what to tap and you'll try it yourself, so it sticks.",
    },
    {
      title: 'Pick a color',
      text: 'First tap the palette button and pick a color. Every pixel you place uses it — switch whenever you like.',
    },
    {
      title: 'Pick your shade',
      text: 'Tap any swatch to make it your color. The outlined square is the one you are painting with right now.',
    },
    {
      title: 'Place your first pixel',
      text: 'Color picked — now place a pixel. First drag the map to the spot you want. On desktop, click right on the canvas; on mobile, turn on the pencil button on the right once, then tap the map where you want — the pixel lands there.',
    },
    {
      title: 'Pixel stock and cooldown',
      text: 'This counter shows your pixel stock and cooldown. Run out and just wait for it to refill — no rush.',
    },
    {
      title: 'Chat',
      text: 'That highlighted button is the chat; tap it anytime to talk to everyone and pick a channel and language. When you are ready, hit Next.',
    },
    {
      title: 'Open the menu',
      text: "This menu button is the gateway to everything else. Tap it and let's see what's inside.",
    },
    {
      title: 'Everything is in this menu',
      text: "There it is. Everything opens from here: settings, your account, templates, screenshots and help. Let me walk you through them, then we'll open your account together.",
    },
    {
      title: 'Settings & themes',
      text: 'Change your theme (look), language and other preferences here. Want to tailor the interface? Start here.',
    },
    {
      title: 'Make it yours',
      text: 'Density, counters, extra panels and privacy switches all live in this window. Play with them — nothing here can break your pixels.',
    },
    {
      title: 'Open your account yourself',
      text: 'Tap the "User Area" item in the menu yourself. This is your account: your profile, stats and all your progress live here. Open it yourself and you will never forget where it is.',
    },
    {
      title: 'Your account and rankings',
      text: 'You opened it — this is your User Area. The tabs up top show your stats and rankings, the converter and factions. For the full faction guide, hit the "?" button in that section.',
    },
    {
      title: "You're set",
      text: 'That is the tour. Templates, themes and reporting are waiting in that same menu. Claim a corner, bring friends and leave your mark.',
    },
  ],
};

const COPY_TR = {
  steps: [
    {
      title: 'Selam, ben Nora',
      text: 'Bu tuvale ben bakıyorum. Hızlı bir tur atalım — her adımda neye dokunacağını göstereceğim, sen de kendin deneyeceksin; böylece aklında kalır.',
    },
    {
      title: 'Bir renk seç',
      text: 'Önce palet düğmesine dokun ve bir renk seç. Koyduğun her piksel bu rengi kullanır — istediğin an değiştirebilirsin.',
    },
    {
      title: 'Tonunu seç',
      text: 'Herhangi bir kareye dokunarak onu rengin yap. Çerçeveli kare, şu an boyadığın renktir.',
    },
    {
      title: 'İlk pikselini koy',
      text: 'Renk seçildi — şimdi bir piksel koy. Önce haritayı istediğin yere sürükle. Bilgisayarda doğrudan tuvale tıkla; telefonda sağdaki kalem düğmesini bir kez aç, sonra istediğin yere dokun — piksel oraya düşer.',
    },
    {
      title: 'Piksel stoğu ve bekleme süresi',
      text: 'Bu sayaç piksel stoğunu ve bekleme süreni gösterir. Biterse dolmasını bekle — acele yok.',
    },
    {
      title: 'Sohbet',
      text: 'Vurgulanan düğme sohbet; istediğin an dokunup herkesle konuşabilir, kanal ve dil seçebilirsin. Hazır olunca İleri’ye bas.',
    },
    {
      title: 'Menüyü aç',
      text: 'Bu menü düğmesi her şeyin kapısı. Dokun ve içeride ne varmış bakalım.',
    },
    {
      title: 'Her şey bu menüde',
      text: 'İşte orada. Her şey buradan açılıyor: ayarlar, hesabın, şablonlar, ekran görüntüsü ve yardım. Hepsini gezelim, sonra hesabını birlikte açacağız.',
    },
    {
      title: 'Ayarlar ve temalar',
      text: 'Temanı (görünümünü), dilini ve diğer tercihlerini buradan değiştir. Arayüzü kendine göre ayarlamak ister misin? Buradan başla.',
    },
    {
      title: 'Kendine göre ayarla',
      text: 'Yoğunluk, sayaçlar, ek paneller ve gizlilik ayarları bu pencerede. Rahatça kurcala — buradan hiçbir şey piksellerine zarar vermez.',
    },
    {
      title: 'Hesabını kendin aç',
      text: 'Menüdeki "Kullanıcı Alanı" seçeneğine kendin dokun. Burası senin hesabın: profilin, istatistiklerin ve tüm ilerlemen burada. Kendin açarsan nerede olduğunu asla unutmazsın.',
    },
    {
      title: 'Hesabın ve sıralamalar',
      text: 'Açtın işte — burası Kullanıcı Alanı. Üstteki sekmeler istatistiklerini ve sıralamalarını, dönüştürücüyü ve fraksiyonları gösterir. Detaylı fraksiyon rehberi için o bölümdeki "?" düğmesine bas.',
    },
    {
      title: 'Hazırsın',
      text: 'Tur bu kadar. Şablonlar, temalar ve şikâyet aynı menüde seni bekliyor. Bir köşe kap, arkadaşlarını getir ve izini bırak.',
    },
  ],
};

/* ---------------------------------------------------------------- builder */

function build(t) {
  const s = t.steps;
  return [
    {
      id: 'welcome',
      title: s[0].title,
      text: s[0].text,
      target: null,
      placement: 'center',
    },
    {
      id: 'palette-button',
      title: s[1].title,
      text: s[1].text,
      target: SEL.paletteButton,
      placement: 'right',
      hint: 'bottom',
      watch: { click: ['#palselbutton'] },
      onNext: 'togglePalette',
    },
    {
      id: 'pick-color',
      title: s[2].title,
      text: s[2].text,
      target: SEL.paletteBox,
      placement: 'right',
      hint: 'inside',
      watch: { click: ['#palettebox'], state: ['selectedColor'] },
      onEnter: 'ensurePalette',
    },
    {
      id: 'place-pixel',
      title: s[3].title,
      text: s[3].text,
      target: SEL.canvas,
      placement: 'auto',
      watch: { pixel: true },
      hintOn: 'pencil',
    },
    {
      id: 'pixel-stock',
      title: s[4].title,
      text: s[4].text,
      target: SEL.stockBox,
      placement: 'auto',
    },
    {
      id: 'chat',
      title: s[5].title,
      text: s[5].text,
      target: SEL.chatButton,
      placement: 'left',
      hint: 'top',
    },
    {
      id: 'open-menu',
      title: s[6].title,
      text: s[6].text,
      target: SEL.menuToggle,
      placement: 'right',
      hint: 'bottom',
      watch: { click: ['#topbtnrow .topbtn', '#topbtncol.open'], dom: ['#topbtncol.open'] },
      onNext: 'openMenu',
    },
    {
      id: 'menu-items',
      title: s[7].title,
      text: s[7].text,
      target: SEL.menuColumnTarget,
      placement: 'right',
      watch: { dom: ['#topbtncol.open'] },
      onEnter: 'ensureMenu',
    },
    {
      id: 'settings',
      title: s[8].title,
      text: s[8].text,
      target: SEL.settingsWindow,
      placement: 'left',
      onEnter: 'openSettings',
      onNext: 'openSettings',
      watch: { dom: ['#wm .window.SETTINGS.show', '#wm .window.SETTINGS'] },
    },
    {
      id: 'settings-interface',
      title: s[9].title,
      text: s[9].text,
      target: SEL.settingsWindow,
      placement: 'left',
      onEnter: 'ensureSettings',
    },
    {
      id: 'user-area',
      title: s[10].title,
      text: s[10].text,
      target: SEL.menuColumnTarget,
      placement: 'right',
      onEnter: 'ensureMenu',
      onNext: 'openUserArea',
      watch: { dom: ['#wm .window.USERAREA.show'], click: ['#topbtncol .topbtn'] },
    },
    {
      id: 'account',
      title: s[11].title,
      text: s[11].text,
      target: SEL.userAreaWindow,
      placement: 'left',
      onEnter: 'ensureUserArea',
    },
    {
      id: 'done',
      title: s[12].title,
      text: s[12].text,
      target: null,
      placement: 'center',
      onEnter: 'closeWindows',
      nextLabel: 'done',
    },
  ];
}

export function getSteps(lang) {
  return build(lang === 'en' ? COPY_EN : COPY_TR);
}

export function getUiText(lang) {
  return UI_TEXT[lang === 'en' ? 'en' : 'tr'];
}

export function getGate(lang) {
  return GATE[lang === 'en' ? 'en' : 'tr'];
}

export const TOUR_TOTAL = 13;
