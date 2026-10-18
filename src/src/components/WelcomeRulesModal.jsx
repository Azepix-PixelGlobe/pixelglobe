/**
 * First-visit welcome + rules modal (TR/EN)
 *
 * The acknowledgement is stored locally so the modal is shown once per
 * browser. To test it again, run:
 * localStorage.removeItem('pg_welcome_v1')
 */
import { useEffect, useState, useCallback } from 'preact/hooks';
import { memo } from 'preact/compat';

import '../styles/welcome-rules.css';

const STORAGE_KEY = 'pg_welcome_v1';

const COPY = {
  tr: {
    welcome: 'PixelGlobe’ye Hoş Geldin!',
    tagline: 'Dünyayı birlikte boyuyoruz.',
    whyTitle: '📢 Kurallar neden var?',
    whyBody:
      'PixelGlobe’u herkes için güvenli, adil, düzenli ve eğlenceli tutmak istiyoruz. Her kuralın topluluk ve oyun düzeni için bir amacı vardır.',
    sections: [
      {
        icon: '🤝',
        title: 'Saygı ve davranış',
        body:
          'Hakaret, nefret söylemi ve spam sohbeti bozar. Birbirine saygılı ol, flood yapma.',
      },
      {
        icon: '🎨',
        title: 'Çizim kuralları',
        body:
          'Başkasının emeğini bozmak (griefing) yasaktır. Politik, NSFW ve uygunsuz içerik yasaktır.',
      },
      {
        icon: '🛡️',
        title: 'Güvenlik · VPN/Proxy',
        body:
          'VPN/Proxy ban kaçmayı ve kötüye kullanımı kolaylaştırabilir; cooldown atlatmak için kullanılabilir. Desteklemiyoruz; engellenebilir.',
      },
      {
        icon: '🚫',
        title: 'Hile ve saldırılar',
        body:
          'Otomatik pixel botları, spam scriptleri ve sunucuya zarar veren araçlar yasaktır.',
      },
      {
        icon: '🔞',
        title: 'Uygunsuz içerik',
        body:
          '18+ / pornografik içerik, çıplaklık ve aşırı şiddet yasaktır. Herkesin rahat kullanacağı bir ortam hedefleriz.',
      },
      {
        icon: '📢',
        title: 'Düzen ve reklam',
        body:
          'Kanalların amacı vardır. İlgisiz içerik ve izinsiz reklam engellenir.',
      },
    ],
    accept: 'Anladım, başla!',
  },
  en: {
    welcome: 'Welcome to PixelGlobe!',
    tagline: 'We paint the world together.',
    whyTitle: '📢 Why do we have rules?',
    whyBody:
      'We want PixelGlobe to stay safe, fair, organized and fun for everyone. Every rule exists for the community and the game.',
    sections: [
      {
        icon: '🤝',
        title: 'Respect & behavior',
        body:
          'Insults, hate speech and spam ruin chat. Be respectful. No flooding.',
      },
      {
        icon: '🎨',
        title: 'Canvas rules',
        body:
          'Griefing others’ art is forbidden. Political, NSFW and inappropriate content is not allowed.',
      },
      {
        icon: '🛡️',
        title: 'Security · VPN/Proxy',
        body:
          'VPN/Proxy can hide abuse and help evade bans or cooldowns. We do not support it; access may be blocked.',
      },
      {
        icon: '🚫',
        title: 'Cheats & attacks',
        body:
          'Auto-pixel bots, spam scripts and tools that harm the server are banned.',
      },
      {
        icon: '🔞',
        title: 'Inappropriate content',
        body:
          '18+ / pornographic content, nudity and extreme violence are forbidden. We aim for a space everyone can enjoy.',
      },
      {
        icon: '📢',
        title: 'Order & ads',
        body:
          'Channels have purposes. Off-topic spam and unauthorized ads are not allowed.',
      },
    ],
    accept: 'Got it, let’s go!',
  },
};

const WelcomeRulesModal = () => {
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState('tr');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') return;
    } catch {
      // Private browsing can disable localStorage; show the modal anyway.
    }

    setOpen(true);
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const close = useCallback(() => {
    setVisible(false);
    setTimeout(() => {
      setOpen(false);
      try {
        localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // The acknowledgement still closes for browsers without storage.
      }
    }, 280);
  }, []);

  if (!open) return null;

  const t = COPY[lang] || COPY.tr;

  return (
    <div
      className={`pg-welcome-overlay ${visible ? 'show' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t.welcome}
    >
      <div className="pg-welcome-orbits" aria-hidden="true" />
      <div className={`pg-welcome-card ${visible ? 'show' : ''}`}>
        <div className="pg-welcome-lang" aria-label="Language">
          <button
            type="button"
            className={lang === 'tr' ? 'active' : ''}
            onClick={() => setLang('tr')}
            aria-pressed={lang === 'tr'}
          >
            🇹🇷 TR
          </button>
          <button
            type="button"
            className={lang === 'en' ? 'active' : ''}
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
          >
            🇬🇧 EN
          </button>
        </div>

        <div className="pg-welcome-logo-wrap">
          <div className="pg-welcome-ring" />
          <img
            className="pg-welcome-logo"
            src="/pg-logo.png"
            alt="PixelGlobe"
            width={120}
            height={120}
          />
        </div>

        <h1 className="pg-welcome-title">{t.welcome}</h1>
        <p className="pg-welcome-tagline">{t.tagline}</p>

        <div className="pg-welcome-scroll">
          <h2 className="pg-welcome-h2">{t.whyTitle}</h2>
          <p className="pg-welcome-why">{t.whyBody}</p>
          {t.sections.map((section) => (
            <div key={section.title} className="pg-welcome-section">
              <div className="pg-welcome-sec-title">
                <span aria-hidden="true">{section.icon}</span>
                {' '}
                {section.title}
              </div>
              <p>{section.body}</p>
            </div>
          ))}
        </div>

        <button type="button" className="pg-welcome-accept" onClick={close}>
          <span className="pg-welcome-accept-glow" aria-hidden="true" />
          {t.accept}
        </button>
      </div>
    </div>
  );
};

export default memo(WelcomeRulesModal);