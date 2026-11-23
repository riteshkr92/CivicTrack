import React from 'react';

export default function SlaGaugeCard({
  totalComplaints = 0,
  overdueCount = 0,
  inProgressCount = 0,
  resolvedCount = 0,
  title = 'Municipal SLA Performance',
  subtitle = 'Real-time metric computed across active municipal caseload'
}) {
  const activeTotal = totalComplaints || 0;
  const withinSlaCount = Math.max(0, activeTotal - overdueCount);
  const compliancePercentage =
    activeTotal > 0 ? Math.round((withinSlaCount / activeTotal) * 100) : 100;

  // SVG circular gauge geometry
  const radius = 52;
  const strokeWidth = 9;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (compliancePercentage / 100) * circumference;

  // Tone color determination
  const getGaugeColor = (pct) => {
    if (pct >= 90) return '#16A34A'; // Success green
    if (pct >= 75) return '#D97706'; // Amber warning
    return '#DC2626'; // Critical red
  };

  const gaugeColor = getGaugeColor(compliancePercentage);

  return (
    <div className="sla-performance-card" aria-label="SLA Compliance Performance">
      <div className="sla-performance-header">
        <div>
          <h3 className="sla-performance-title">{title}</h3>
          <span className="sla-performance-sub">
            {subtitle}
          </span>
        </div>
        <div className="sla-performance-badge">
          <span className="pulse-indicator-dot" aria-hidden="true" />
          <span>Active SLA Engine</span>
        </div>
      </div>

      <div className="sla-performance-body">
        {/* Circular SVG Gauge */}
        <div className="sla-gauge-wrapper">
          <svg
            className="sla-gauge-svg"
            width="136"
            height="136"
            viewBox="0 0 136 136"
            aria-hidden="true"
          >
            {/* Background Track */}
            <circle
              cx="68"
              cy="68"
              r={radius}
              fill="none"
              stroke="#E2E8F0"
              strokeWidth={strokeWidth}
            />
            {/* Animated Progress Arc */}
            <circle
              cx="68"
              cy="68"
              r={radius}
              fill="none"
              stroke={gaugeColor}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform="rotate(-90 68 68)"
              style={{ transition: 'stroke-dashoffset 0.6s ease' }}
            />
          </svg>
          <div className="sla-gauge-center-text">
            <span className="sla-gauge-percent" style={{ color: gaugeColor }}>
              {compliancePercentage}%
            </span>
            <span className="sla-gauge-label">Compliance</span>
          </div>
        </div>

        {/* Breakdown Stats Column */}
        <div className="sla-breakdown-list">
          <div className="sla-breakdown-row">
            <div className="sla-breakdown-info">
              <span className="sla-indicator-dot success" />
              <span className="sla-breakdown-label">Compliant within SLA</span>
            </div>
            <span className="sla-breakdown-count">{withinSlaCount}</span>
          </div>

          <div className="sla-breakdown-row">
            <div className="sla-breakdown-info">
              <span className="sla-indicator-dot danger" />
              <span className="sla-breakdown-label">SLA Breached / Overdue</span>
            </div>
            <span className="sla-breakdown-count">{overdueCount}</span>
          </div>

          <div className="sla-breakdown-row">
            <div className="sla-breakdown-info">
              <span className="sla-indicator-dot blue" />
              <span className="sla-breakdown-label">In Active Remediation</span>
            </div>
            <span className="sla-breakdown-count">{inProgressCount}</span>
          </div>

          <div className="sla-breakdown-row">
            <div className="sla-breakdown-info">
              <span className="sla-indicator-dot green" />
              <span className="sla-breakdown-label">Successfully Resolved</span>
            </div>
            <span className="sla-breakdown-count">{resolvedCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
