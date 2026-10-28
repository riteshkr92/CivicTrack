import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Status color palette for map pins & UI
const STATUS_COLORS = {
  Submitted: '#2563eb', // Blue
  'Under Review': '#d97706', // Amber
  'In Progress': '#7c3aed', // Purple
  Resolved: '#16a34a', // Green
  Rejected: '#dc2626' // Red
};

// Create custom SVG marker icon with high visibility and pin pointer
const createStatusIcon = (status) => {
  const color = STATUS_COLORS[status] || '#64748b';
  const svgHtml = `
    <div style="
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      background: #ffffff;
      border: 3px solid ${color};
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 3px 8px rgba(0,0,0,0.35);
      cursor: pointer;
      transition: transform 0.15s ease;
    ">
      <div style="
        width: 10px;
        height: 10px;
        background: ${color};
        border-radius: 50%;
        transform: rotate(45deg);
      "></div>
    </div>
  `;

  return L.divIcon({
    html: svgHtml,
    className: 'custom-leaflet-pin',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -32]
  });
};

export default function IssueMap({
  complaints = [],
  onSelectComplaint,
  loading = false,
  error = null,
  onRetry = null,
  role = 'citizen',
  isFullPage = false,
  onNavigateReport = null
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const onSelectComplaintRef = useRef(onSelectComplaint);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onSelectComplaintRef.current = onSelectComplaint;
  }, [onSelectComplaint]);

  // Extract complaints with valid numeric latitude & longitude within valid global bounds
  const validComplaints = useMemo(() => {
    return (complaints || []).filter((c) => {
      const lat =
        c?.location?.latitude !== undefined && c.location.latitude !== null
          ? Number(c.location.latitude)
          : null;
      const lng =
        c?.location?.longitude !== undefined && c.location.longitude !== null
          ? Number(c.location.longitude)
          : null;

      return (
        lat !== null &&
        !isNaN(lat) &&
        lng !== null &&
        !isNaN(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
      );
    });
  }, [complaints]);

  // Status breakdown counters for filter chips
  const statusCounts = useMemo(() => {
    const counts = {
      ALL: validComplaints.length,
      Submitted: 0,
      'Under Review': 0,
      'In Progress': 0,
      Resolved: 0,
      Rejected: 0
    };
    validComplaints.forEach((c) => {
      if (counts[c.status] !== undefined) {
        counts[c.status]++;
      }
    });
    return counts;
  }, [validComplaints]);

  // Filter complaints based on active status filter
  const displayedComplaints = useMemo(() => {
    if (statusFilter === 'ALL') return validComplaints;
    return validComplaints.filter((c) => c.status === statusFilter);
  }, [validComplaints, statusFilter]);

  // 1. Initialize Leaflet map instance ONCE upon mount
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    // Safely clear any existing leaflet id on container to prevent "already initialized" errors
    if (container._leaflet_id && mapInstanceRef.current) {
      try {
        mapInstanceRef.current.remove();
      } catch (e) {
        // ignore error during cleanup
      }
      mapInstanceRef.current = null;
    }
    container._leaflet_id = null;

    // Default reference center (Municipal reference coordinates)
    const defaultCenter = [12.9716, 77.5946];
    const defaultZoom = 12;

    const map = L.map(container, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: true,
      scrollWheelZoom: true,
      fadeAnimation: true,
      zoomAnimation: true
    });

    mapInstanceRef.current = map;

    // OpenStreetMap tile layer (Reliable, high-availability, free open standard)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Create a LayerGroup for markers
    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;

    setMapReady(true);

    // Invalidate size after layout completes
    const timer = setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 150);

    // Invalidate size on window resize
    const handleResize = () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    };
    window.addEventListener('resize', handleResize);

    // ResizeObserver on the map container
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize();
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch (err) {
          // ignore cleanup errors
        }
        mapInstanceRef.current = null;
      }
      markersLayerRef.current = null;
      setMapReady(false);
    };
  }, []);

  // 2. Reactively update markers whenever displayedComplaints changes or map becomes ready
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersLayer = markersLayerRef.current;
    if (!map || !markersLayer || !mapReady) return;

    // Clear previous markers
    markersLayer.clearLayers();

    const bounds = [];

    displayedComplaints.forEach((issue) => {
      const lat = Number(issue.location.latitude);
      const lng = Number(issue.location.longitude);
      bounds.push([lat, lng]);

      const marker = L.marker([lat, lng], {
        icon: createStatusIcon(issue.status),
        title: `${issue.trackingId}: ${issue.title}`,
        alt: `${issue.trackingId} location pin`
      });

      // Accessible, styled popup
      const popupDiv = document.createElement('div');
      popupDiv.className = 'leaflet-custom-popup';
      popupDiv.style.minWidth = '220px';
      popupDiv.style.maxWidth = '290px';
      popupDiv.style.padding = '4px 2px';

      const statusColor = STATUS_COLORS[issue.status] || '#64748b';
      const formattedDate = issue.createdAt
        ? new Date(issue.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          })
        : '';

      popupDiv.innerHTML = `
        <div style="font-family: inherit; font-size: 13px; line-height: 1.45;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
            <span style="font-weight: 700; color: #2563eb; font-size: 11px; background: #eff6ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #bfdbfe;">
              ${issue.trackingId || 'CT-REF'}
            </span>
            <span style="font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 9999px; background: ${statusColor}; color: white; text-transform: capitalize;">
              ${issue.status}
            </span>
          </div>
          <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px; font-size: 13px; word-break: break-word;">
            ${issue.title}
          </div>
          <div style="display: inline-block; font-size: 10.5px; font-weight: 600; color: #475569; background: #f1f5f9; padding: 1px 6px; border-radius: 4px; margin-bottom: 6px;">
            ${issue.category || 'General'}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 4px; word-break: break-word;">
            📍 ${issue.location?.address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`}
          </div>
          ${
            formattedDate
              ? `<div style="font-size: 10.5px; color: #94a3b8; margin-bottom: 8px;">Reported on ${formattedDate}</div>`
              : ''
          }
          <button
            type="button"
            class="map-popup-btn"
            style="
              display: block;
              width: 100%;
              padding: 6px 10px;
              background: #2563eb;
              color: white;
              border: none;
              border-radius: 6px;
              font-size: 11.5px;
              font-weight: 600;
              cursor: pointer;
              text-align: center;
              transition: background 0.15s ease;
            "
          >
            Inspect Complaint Details &rarr;
          </button>
        </div>
      `;

      // Attach click handler to inspect button inside popup
      const btn = popupDiv.querySelector('.map-popup-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (onSelectComplaintRef.current) {
            onSelectComplaintRef.current(issue);
          }
        });
      }

      marker.bindPopup(popupDiv, { maxWidth: 300 });
      markersLayer.addLayer(marker);
    });

    // Auto-fit bounds or center
    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else if (statusFilter === 'ALL' && validComplaints.length === 0) {
      // Default municipal reference center
      map.setView([12.9716, 77.5946], 12);
    }

    // Invalidate size once markers render
    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.invalidateSize();
      }
    }, 100);
  }, [displayedComplaints, mapReady, statusFilter, validComplaints.length]);

  // Recenter map action
  const handleRecenter = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const bounds = displayedComplaints.map((c) => [
      Number(c.location.latitude),
      Number(c.location.longitude)
    ]);

    if (bounds.length > 1) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    } else {
      map.setView([12.9716, 77.5946], 12);
    }
    map.invalidateSize();
  }, [displayedComplaints]);

  const mapHeight = isFullPage ? 'min(580px, 68vh)' : '380px';

  return (
    <section
      className={`map-panel-card ${isFullPage ? 'map-panel-fullpage' : ''}`}
      aria-label="City Geographic Complaint Map"
    >
      {/* Map Header */}
      <div className="map-panel-header">
        <div className="map-title-group">
          <div className="map-icon-box" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
          </div>
          <div>
            <h2 className="map-panel-title">
              {role === 'citizen'
                ? 'My Reported Incidents Map'
                : role === 'officer'
                ? 'Assigned Field Task Locations'
                : 'Municipal City-Wide Incidents Map'}
            </h2>
            <p className="map-panel-subtitle">
              Interactive Leaflet GIS with verified coordinates &bull; OpenStreetMap
            </p>
          </div>
        </div>

        <div className="map-header-actions">
          <button
            type="button"
            className="map-recenter-btn"
            onClick={handleRecenter}
            title="Recenter and fit all plotted complaint markers"
            aria-label="Recenter map view"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="22" y1="12" x2="18" y2="12" />
              <line x1="6" y1="12" x2="2" y2="12" />
              <line x1="12" y1="6" x2="12" y2="2" />
              <line x1="12" y1="22" x2="12" y2="18" />
            </svg>
            <span>Recenter Map</span>
          </button>

          <span className="map-pins-count-pill">
            <strong>{displayedComplaints.length}</strong> of {validComplaints.length} Plotted
          </span>
        </div>
      </div>

      {/* Status Filter Bar */}
      <div className="map-filter-bar" role="toolbar" aria-label="Map status filter">
        <span className="map-filter-label">Filter Markers:</span>
        <div className="map-filter-chips">
          {['ALL', 'Submitted', 'Under Review', 'In Progress', 'Resolved', 'Rejected'].map((statusKey) => {
            const count = statusCounts[statusKey] || 0;
            const isActive = statusFilter === statusKey;
            const dotColor = statusKey === 'ALL' ? '#2563eb' : STATUS_COLORS[statusKey] || '#64748b';

            return (
              <button
                key={statusKey}
                type="button"
                className={`map-filter-chip ${isActive ? 'active' : ''}`}
                onClick={() => setStatusFilter(statusKey)}
                aria-pressed={isActive}
              >
                <span className="filter-chip-dot" style={{ background: dotColor }} />
                <span>{statusKey}</span>
                <span className="filter-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="map-error-banner" role="alert">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="map-error-text">{error}</span>
          {onRetry && (
            <button type="button" className="map-retry-btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}

      {/* Map Canvas Container */}
      <div
        className="map-canvas-container"
        style={{
          position: 'relative',
          height: mapHeight,
          width: '100%',
          backgroundColor: '#e2e8f0'
        }}
      >
        <div
          ref={mapContainerRef}
          style={{ height: '100%', width: '100%', zIndex: 1 }}
          aria-label="Interactive map of civic complaints"
        />

        {/* Loading Overlay */}
        {loading && (
          <div className="map-loading-overlay" aria-live="polite">
            <div className="map-loading-box">
              <span className="map-spinner" />
              <span>Loading civic complaints & coordinates...</span>
            </div>
          </div>
        )}

        {/* Empty Overlay */}
        {!loading && !error && validComplaints.length === 0 && (
          <div className="map-empty-overlay">
            <div className="map-empty-message-box">
              <div className="map-empty-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              </div>
              <div className="map-empty-text-wrap">
                <h3 className="map-empty-heading">No Incident Coordinates Plotted</h3>
                <p className="map-empty-sub">
                  {role === 'citizen'
                    ? "You haven't submitted any complaints with GPS coordinates yet. When you report an issue, its verified location will appear here."
                    : role === 'officer'
                    ? "There are currently no complaints with GPS coordinates assigned to your queue."
                    : "No complaints with valid geographic coordinates found in the system."}
                </p>
                {role === 'citizen' && onNavigateReport && (
                  <button
                    type="button"
                    className="card-btn blue-solid"
                    style={{ marginTop: '0.75rem', fontSize: '0.82rem', padding: '6px 14px' }}
                    onClick={onNavigateReport}
                  >
                    + Report a Geotagged Issue
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Filter Zero Results Overlay */}
        {!loading && !error && validComplaints.length > 0 && displayedComplaints.length === 0 && (
          <div className="map-empty-overlay">
            <div className="map-empty-message-box">
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                No complaints currently match the <strong>"{statusFilter}"</strong> filter.
              </p>
              <button
                type="button"
                className="map-retry-btn"
                style={{ marginTop: '0.5rem' }}
                onClick={() => setStatusFilter('ALL')}
              >
                Show All ({validComplaints.length})
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Map Legend Footer */}
      <div className="map-legend-footer">
        <div className="legend-items-row">
          <span className="legend-title">Status Key:</span>
          {Object.entries(STATUS_COLORS).map(([statusName, color]) => (
            <div key={statusName} className="legend-item">
              <span className="legend-dot" style={{ background: color }} />
              <span>{statusName}</span>
              <span className="legend-count">({statusCounts[statusName] || 0})</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
