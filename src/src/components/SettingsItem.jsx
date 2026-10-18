const SettingsItem = ({
  title, keyBind, value, onToggle, children, deactivated,
}) => (
  <div className="setitem">
    <div className="setrow">
      <h3 className="settitle">
        {title} {keyBind && <kbd>{keyBind}</kbd>}
      </h3>
      <input
        type="checkbox"
        checked={value}
        onChange={onToggle}
        disabled={deactivated}
        className="settings-checkbox"
      />
    </div>
    <div className="modaldesc">{children}</div>
    <div className="modaldivider" />
  </div>
);

export default SettingsItem;
