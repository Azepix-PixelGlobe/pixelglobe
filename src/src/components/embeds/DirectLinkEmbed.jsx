const DirectLinkEmbed = ({
  url, fill, maxHeight, aspectRatio = 56.35, strictReferrer,
}) => {
  const iFrame = (
    <iframe
      style={{
        position: 'absolute',
        width: '100%',
        height: '100%',
      }}
      src={url}
      frameBorder="0"
      // eslint-disable-next-line max-len
      referrerPolicy={strictReferrer ? 'strict-origin-when-cross-origin' : 'no-referrer'}
      allow="autoplay; picture-in-picture; encrypted-media"
      scrolling="no"
      // eslint-disable-next-line max-len
      sandbox="allow-scripts allow-modals allow-forms allow-popups allow-same-origin allow-presentation"
      allowFullScreen
      title="Embedded Videosite"
    />
  );

  return (fill) ? iFrame : (
    <div
      style={{
        position: 'relative',
        height: 0,
        width: '100%',
        paddingBottom: (maxHeight)
          ? `min(${aspectRatio}%, ${maxHeight}px)` : `${aspectRatio}%`,
        maxWidth: (maxHeight) && maxHeight * 100 / aspectRatio,
        left: (maxHeight) && '50%',
        transform: (maxHeight) && 'translateX(-50%)',
        textAlign: 'initial',
        margin: 3,
      }}
    >
      {iFrame}
    </div>
  );
};

export default [
  DirectLinkEmbed,
  () => true,
  null,
  '/embico/direct.png',
];
