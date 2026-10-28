import React from 'react';

export default function StatCard({
  icon,
  label,
  value,
  subtext,
  colorScheme = 'blue',
  isUnavailable = false
}) {
  return (
    <div className={`metric-card border-${colorScheme}`}>
      <div className="metric-header-row">
        <span className="metric-label">{label}</span>
        <div className={`metric-icon-box ${colorScheme}`} aria-hidden="true">
          {icon}
        </div>
      </div>

      <div className="metric-body">
        <div className={`metric-value ${isUnavailable ? 'metric-unavailable' : ''}`}>
          {value}
        </div>
      </div>

      <div className="metric-footer">
        <span className="metric-subtext">{subtext}</span>
      </div>
    </div>
  );
}
