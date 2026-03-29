(function () {
  const IN_TO_M = 0.0254;
  const DEFAULT_YAW = -0.78;
  const DEFAULT_PITCH = -0.48;
  const DEFAULT_ZOOM = 1.0;
  const MIN_ZOOM = 0.55;
  const MAX_ZOOM = 2.4;
  const MIN_PITCH = -1.56;
  const MAX_PITCH = 1.56;
  const ROOM_STROKE = "rgba(176, 192, 224, 0.82)";
  const ROOM_FILL = "rgba(91, 181, 255, 0.05)";
  const FLOOR_FILL = "rgba(44, 56, 82, 0.52)";
  const AHU_TOP = "rgba(159, 180, 206, 0.95)";
  const AHU_SIDE = "rgba(93, 111, 133, 0.95)";
  const AHU_FRONT = "rgba(71, 83, 99, 0.95)";
  const SUPPLY_TOP = "rgba(77, 170, 255, 0.96)";
  const SUPPLY_SIDE = "rgba(29, 83, 145, 0.98)";
  const SUPPLY_FRONT = "rgba(53, 116, 190, 0.98)";
  const RETURN_TOP = "rgba(255, 151, 127, 0.94)";
  const RETURN_SIDE = "rgba(155, 86, 92, 0.98)";
  const RETURN_FRONT = "rgba(195, 107, 96, 0.98)";
  const PROCESS_TOP = "rgba(255, 197, 108, 0.94)";
  const PROCESS_SIDE = "rgba(141, 97, 31, 0.98)";
  const PROCESS_FRONT = "rgba(181, 120, 36, 0.98)";
  const TERMINAL_SUPPLY = "rgba(102, 196, 255, 1)";
  const TERMINAL_RETURN = "rgba(255, 174, 121, 1)";
  const LABEL_COLOR = "rgba(229, 236, 251, 0.96)";
  const GRID_COLOR = "rgba(137, 154, 188, 0.14)";
  const VIEW_PRESETS = {
    iso: { yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH, zoom: DEFAULT_ZOOM, projection: "perspective" },
    top: { yaw: 0, pitch: -Math.PI / 2, zoom: 0.98, projection: "orthographic" },
    bottom: { yaw: 0, pitch: Math.PI / 2, zoom: 0.94, projection: "orthographic" },
    front: { yaw: 0, pitch: 0, zoom: 1.05, projection: "orthographic" },
    back: { yaw: Math.PI, pitch: 0, zoom: 1.05, projection: "orthographic" },
    left: { yaw: Math.PI / 2, pitch: 0, zoom: 1.05, projection: "orthographic" },
    right: { yaw: -Math.PI / 2, pitch: 0, zoom: 1.05, projection: "orthographic" }
  };
  const instances = new WeakMap();

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function roundTo(value, digits) {
    const factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
  }

  function safeDiv(numerator, denominator, fallback) {
    return denominator ? numerator / denominator : (fallback || 0);
  }

  function colorWithAlpha(color, alpha) {
    const clampedAlpha = clamp(alpha, 0, 1);
    if (!color) {
      return "rgba(255,255,255," + clampedAlpha + ")";
    }
    if (color.indexOf("rgba(") === 0) {
      return color.replace(/rgba\(([^)]+),\s*[^,]+\)$/, function (_, channels) {
        return "rgba(" + channels + ", " + clampedAlpha + ")";
      });
    }
    if (color.indexOf("rgb(") === 0) {
      return color.replace("rgb(", "rgba(").replace(")", ", " + clampedAlpha + ")");
    }
    if (color.charAt(0) === "#") {
      let hex = color.slice(1);
      if (hex.length === 3) {
        hex = hex.split("").map(function (digit) {
          return digit + digit;
        }).join("");
      }
      if (hex.length === 6) {
        const red = parseInt(hex.slice(0, 2), 16);
        const green = parseInt(hex.slice(2, 4), 16);
        const blue = parseInt(hex.slice(4, 6), 16);
        return "rgba(" + red + ", " + green + ", " + blue + ", " + clampedAlpha + ")";
      }
    }
    return color;
  }

  function seededUnit(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
    return value - Math.floor(value);
  }

  function lerp(start, end, t) {
    return start + (end - start) * t;
  }

  function normalizeAngle(angle) {
    let next = angle;
    while (next > Math.PI) {
      next -= Math.PI * 2;
    }
    while (next < -Math.PI) {
      next += Math.PI * 2;
    }
    return next;
  }

  function lerpAngle(start, end, t) {
    const delta = normalizeAngle(end - start);
    return normalizeAngle(start + delta * t);
  }

  function point(x, y, z) {
    return { x: x, y: y, z: z };
  }

  function clonePoint(value) {
    return point(value.x, value.y, value.z);
  }

  function addPoint(left, right) {
    return point(left.x + right.x, left.y + right.y, left.z + right.z);
  }

  function subPoint(left, right) {
    return point(left.x - right.x, left.y - right.y, left.z - right.z);
  }

  function mulPoint(value, scalar) {
    return point(value.x * scalar, value.y * scalar, value.z * scalar);
  }

  function dist(left, right) {
    const dx = left.x - right.x;
    const dy = left.y - right.y;
    const dz = left.z - right.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  function ductSection(duct, fallbackSizeM) {
    const fallback = Math.max(fallbackSizeM || 0.2, 0.08);
    if (!duct) {
      return {
        width: fallback,
        height: fallback * 0.8,
        label: roundTo(fallback, 2) + " m visual",
        circular: false
      };
    }

    if (duct.rectW && duct.rectH) {
      return {
        width: Math.max(duct.rectW * IN_TO_M, 0.06),
        height: Math.max(duct.rectH * IN_TO_M, 0.06),
        label: duct.rectW + '" x ' + duct.rectH + '"',
        circular: false
      };
    }

    if (duct.dia_in) {
      const diameter = Math.max(duct.dia_in * IN_TO_M, 0.06);
      return {
        width: diameter,
        height: diameter,
        label: 'O ' + duct.dia_in + '"',
        circular: true
      };
    }

    return {
      width: fallback,
      height: fallback * 0.8,
      label: roundTo(fallback, 2) + " m visual",
      circular: false
    };
  }

  function createBoxObject(min, max, style, label) {
    return {
      kind: "box",
      min: min,
      max: max,
      style: style,
      label: label || null
    };
  }

  function buildSegmentBox(start, end, section, style, label) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const absDz = Math.abs(dz);
    const halfWidth = Math.max((section && section.width) || 0.14, 0.04) / 2;
    const halfHeight = Math.max((section && section.height) || 0.12, 0.04) / 2;
    let min;
    let max;

    if (absDx >= absDy && absDx >= absDz) {
      min = point(Math.min(start.x, end.x), start.y - halfWidth, start.z - halfHeight);
      max = point(Math.max(start.x, end.x), start.y + halfWidth, start.z + halfHeight);
    } else if (absDy >= absDx && absDy >= absDz) {
      min = point(start.x - halfWidth, Math.min(start.y, end.y), start.z - halfHeight);
      max = point(start.x + halfWidth, Math.max(start.y, end.y), start.z + halfHeight);
    } else {
      const depth = Math.max(halfWidth, halfHeight * 0.75);
      min = point(start.x - halfWidth, start.y - depth, Math.min(start.z, end.z));
      max = point(start.x + halfWidth, start.y + depth, Math.max(start.z, end.z));
    }

    return createBoxObject(min, max, style, label);
  }

  function addPolylineBoxes(objects, points, section, style, labelPrefix) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (dist(start, end) < 0.001) {
        continue;
      }
      objects.push(buildSegmentBox(start, end, section, style, labelPrefix && index === points.length - 2 ? labelPrefix : null));
    }
  }

  function addEndCapBox(objects, anchor, reference, section, style) {
    if (!anchor || !reference) {
      return;
    }
    const dx = reference.x - anchor.x;
    const dy = reference.y - anchor.y;
    const dz = reference.z - anchor.z;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const absDz = Math.abs(dz);
    const halfWidth = Math.max((section && section.width) || 0.14, 0.04) / 2;
    const halfHeight = Math.max((section && section.height) || 0.12, 0.04) / 2;
    const capDepth = clamp(Math.min(halfWidth, halfHeight) * 0.48, 0.025, 0.08);
    let min;
    let max;

    if (absDx >= absDy && absDx >= absDz) {
      min = point(anchor.x - capDepth / 2, anchor.y - halfWidth, anchor.z - halfHeight);
      max = point(anchor.x + capDepth / 2, anchor.y + halfWidth, anchor.z + halfHeight);
    } else if (absDy >= absDx && absDy >= absDz) {
      min = point(anchor.x - halfWidth, anchor.y - capDepth / 2, anchor.z - halfHeight);
      max = point(anchor.x + halfWidth, anchor.y + capDepth / 2, anchor.z + halfHeight);
    } else {
      const depth = Math.max(halfWidth, halfHeight * 0.75);
      min = point(anchor.x - halfWidth, anchor.y - depth, anchor.z - capDepth / 2);
      max = point(anchor.x + halfWidth, anchor.y + depth, anchor.z + capDepth / 2);
    }

    objects.push(createBoxObject(min, max, style));
  }

  function addClosedPolylineBoxes(objects, points, section, style, labelPrefix) {
    addPolylineBoxes(objects, points, section, style, labelPrefix);
    if (points && points.length >= 2) {
      addEndCapBox(objects, points[0], points[1], section, style);
      addEndCapBox(objects, points[points.length - 1], points[points.length - 2], section, style);
    }
  }

  function addAhuUnit(objects, min, max) {
    const width = max.x - min.x;
    const depth = max.y - min.y;
    const height = max.z - min.z;
    const plinthHeight = clamp(height * 0.08, 0.08, 0.16);
    const shellMin = point(min.x, min.y, min.z + plinthHeight);
    const shellMax = clonePoint(max);
    const coilBandX0 = min.x + width * 0.18;
    const coilBandX1 = min.x + width * 0.31;
    const fanBandX0 = min.x + width * 0.68;
    const panelInset = Math.min(width, depth) * 0.05;

    objects.push(createBoxObject(
      min,
      point(max.x, max.y, min.z + plinthHeight),
      {
        topFill: "rgba(78, 86, 101, 0.98)",
        sideFill: "rgba(45, 50, 60, 0.98)",
        sideFillAlt: "rgba(39, 43, 52, 0.98)",
        frontFill: "rgba(56, 62, 75, 0.98)",
        frontFillAlt: "rgba(46, 52, 64, 0.98)",
        bottomFill: "rgba(33, 37, 45, 0.98)",
        stroke: "rgba(196, 208, 225, 0.22)"
      }
    ));
    objects.push(createBoxObject(
      shellMin,
      shellMax,
      {
        topFill: AHU_TOP,
        sideFill: AHU_SIDE,
        sideFillAlt: "rgba(78, 92, 110, 0.99)",
        frontFill: AHU_FRONT,
        frontFillAlt: "rgba(56, 66, 79, 0.99)",
        bottomFill: "rgba(35, 41, 49, 0.95)",
        stroke: "rgba(225, 233, 247, 0.28)"
      }
    ));

    objects.push(createBoxObject(
      point(coilBandX0, min.y + panelInset, shellMin.z + height * 0.12),
      point(coilBandX1, max.y - panelInset, shellMax.z - height * 0.12),
      {
        topFill: "rgba(84, 190, 255, 0.94)",
        sideFill: "rgba(29, 119, 175, 0.96)",
        sideFillAlt: "rgba(22, 95, 142, 0.96)",
        frontFill: "rgba(48, 149, 210, 0.96)",
        frontFillAlt: "rgba(36, 126, 184, 0.96)",
        bottomFill: "rgba(18, 78, 120, 0.94)",
        stroke: "rgba(213, 244, 255, 0.24)"
      }
    ));
    objects.push(createBoxObject(
      point(fanBandX0, min.y + panelInset, shellMin.z + height * 0.16),
      point(max.x - width * 0.08, max.y - panelInset, shellMax.z - height * 0.18),
      {
        topFill: "rgba(176, 188, 204, 0.92)",
        sideFill: "rgba(96, 110, 128, 0.96)",
        sideFillAlt: "rgba(82, 94, 110, 0.96)",
        frontFill: "rgba(126, 140, 159, 0.96)",
        frontFillAlt: "rgba(110, 124, 142, 0.96)",
        bottomFill: "rgba(73, 82, 95, 0.94)",
        stroke: "rgba(226, 236, 249, 0.20)"
      }
    ));

    for (let panelIndex = 1; panelIndex <= 2; panelIndex += 1) {
      const x = min.x + width * (0.18 + panelIndex * 0.22);
      objects.push(createBoxObject(
        point(x, max.y - panelInset * 0.8, shellMin.z + 0.12),
        point(x + 0.025, max.y - panelInset * 0.2, shellMax.z - 0.12),
        {
          topFill: "rgba(202, 214, 230, 0.95)",
          sideFill: "rgba(118, 133, 151, 0.96)",
          sideFillAlt: "rgba(103, 117, 134, 0.96)",
          frontFill: "rgba(160, 173, 192, 0.96)",
          frontFillAlt: "rgba(142, 156, 176, 0.96)",
          bottomFill: "rgba(88, 98, 112, 0.94)",
          stroke: "rgba(233, 240, 250, 0.12)"
        }
      ));
    }

    objects.push(createBoxObject(
      point(min.x + width * 0.08, max.y - 0.03, shellMin.z + height * 0.24),
      point(min.x + width * 0.16, max.y + 0.12, shellMax.z - height * 0.18),
      {
        topFill: "rgba(168, 183, 201, 0.92)",
        sideFill: "rgba(95, 109, 126, 0.95)",
        sideFillAlt: "rgba(80, 93, 108, 0.95)",
        frontFill: "rgba(124, 140, 159, 0.96)",
        frontFillAlt: "rgba(107, 123, 141, 0.96)",
        bottomFill: "rgba(68, 77, 90, 0.94)",
        stroke: "rgba(220, 231, 244, 0.18)"
      }
    ));
  }

  function addDiffuserAssembly(objects, supplyPoint, ceilingZ) {
    const visualScale = 1.18;
    const frameHalf = 0.22 * visualScale;
    const neckHalf = 0.08 * visualScale;
    const frameTop = ceilingZ + 0.008;
    const frameBottom = ceilingZ - 0.044;
    const coreHalf = 0.09 * visualScale;

    objects.push(createBoxObject(
      point(supplyPoint.x - frameHalf, supplyPoint.y - frameHalf, frameBottom),
      point(supplyPoint.x + frameHalf, supplyPoint.y + frameHalf, frameTop),
      {
        topFill: "rgba(233, 244, 252, 0.98)",
        sideFill: "rgba(166, 185, 203, 0.98)",
        sideFillAlt: "rgba(146, 165, 184, 0.98)",
        frontFill: "rgba(202, 218, 235, 0.98)",
        frontFillAlt: "rgba(186, 202, 219, 0.98)",
        bottomFill: "rgba(144, 161, 179, 0.96)",
        stroke: "rgba(255,255,255,0.22)"
      }
    ));
    objects.push(createBoxObject(
      point(supplyPoint.x - neckHalf, supplyPoint.y - neckHalf, ceilingZ - 0.12),
      point(supplyPoint.x + neckHalf, supplyPoint.y + neckHalf, frameBottom),
      {
        topFill: "rgba(179, 197, 216, 0.96)",
        sideFill: "rgba(93, 111, 129, 0.96)",
        sideFillAlt: "rgba(82, 99, 116, 0.96)",
        frontFill: "rgba(133, 149, 168, 0.96)",
        frontFillAlt: "rgba(116, 133, 150, 0.96)",
        bottomFill: "rgba(72, 83, 96, 0.94)",
        stroke: "rgba(235, 244, 255, 0.12)"
      }
    ));
    objects.push(createBoxObject(
      point(supplyPoint.x - coreHalf, supplyPoint.y - coreHalf, frameBottom - 0.012),
      point(supplyPoint.x + coreHalf, supplyPoint.y + coreHalf, frameTop + 0.004),
      {
        topFill: "rgba(250, 252, 255, 0.98)",
        sideFill: "rgba(193, 205, 219, 0.98)",
        sideFillAlt: "rgba(171, 183, 198, 0.98)",
        frontFill: "rgba(225, 233, 242, 0.98)",
        frontFillAlt: "rgba(208, 219, 229, 0.98)",
        bottomFill: "rgba(154, 168, 183, 0.96)",
        stroke: "rgba(255,255,255,0.20)"
      }
    ));

    [ -0.12, 0, 0.12 ].forEach(function (offset) {
      objects.push(createBoxObject(
        point(supplyPoint.x - frameHalf * 0.74, supplyPoint.y + offset - 0.012, frameBottom - 0.01),
        point(supplyPoint.x + frameHalf * 0.74, supplyPoint.y + offset + 0.012, frameTop),
        {
          topFill: "rgba(222, 232, 243, 0.95)",
          sideFill: "rgba(154, 170, 188, 0.96)",
          sideFillAlt: "rgba(138, 154, 171, 0.96)",
          frontFill: "rgba(196, 210, 224, 0.96)",
          frontFillAlt: "rgba(180, 194, 209, 0.96)",
          bottomFill: "rgba(130, 144, 160, 0.94)",
          stroke: "rgba(255,255,255,0.10)"
        }
      ));
      objects.push(createBoxObject(
        point(supplyPoint.x + offset - 0.012, supplyPoint.y - frameHalf * 0.74, frameBottom - 0.01),
        point(supplyPoint.x + offset + 0.012, supplyPoint.y + frameHalf * 0.74, frameTop),
        {
          topFill: "rgba(222, 232, 243, 0.95)",
          sideFill: "rgba(154, 170, 188, 0.96)",
          sideFillAlt: "rgba(138, 154, 171, 0.96)",
          frontFill: "rgba(196, 210, 224, 0.96)",
          frontFillAlt: "rgba(180, 194, 209, 0.96)",
          bottomFill: "rgba(130, 144, 160, 0.94)",
          stroke: "rgba(255,255,255,0.10)"
        }
      ));
    });
  }

  function addReturnGrilleAssembly(objects, grilleMin, grilleMax, orientation) {
    const visualScale = 1.16;
    const centerX = (grilleMin.x + grilleMax.x) / 2;
    const centerY = (grilleMin.y + grilleMax.y) / 2;
    const centerZ = (grilleMin.z + grilleMax.z) / 2;
    const halfX = (grilleMax.x - grilleMin.x) * visualScale / 2;
    const halfY = (grilleMax.y - grilleMin.y) * visualScale / 2;
    const halfZ = (grilleMax.z - grilleMin.z) * visualScale / 2;
    const outerMin = point(centerX - halfX, centerY - halfY, centerZ - halfZ);
    const outerMax = point(centerX + halfX, centerY + halfY, centerZ + halfZ);
    const outerStyle = {
      topFill: "rgba(236, 226, 220, 0.98)",
      sideFill: "rgba(170, 139, 128, 0.98)",
      sideFillAlt: "rgba(150, 123, 114, 0.98)",
      frontFill: "rgba(210, 178, 164, 0.98)",
      frontFillAlt: "rgba(192, 160, 148, 0.98)",
      bottomFill: "rgba(138, 110, 101, 0.96)",
      stroke: "rgba(255, 240, 230, 0.18)"
    };
    objects.push(createBoxObject(outerMin, outerMax, outerStyle));

    const slatCount = 4;
    if (orientation === "ceiling") {
      const plenumDepth = 0.14;
      objects.push(createBoxObject(
        point(outerMin.x + 0.055, outerMin.y + 0.055, outerMax.z),
        point(outerMax.x - 0.055, outerMax.y - 0.055, outerMax.z + plenumDepth),
        {
          topFill: "rgba(132, 104, 98, 0.95)",
          sideFill: "rgba(86, 63, 59, 0.96)",
          sideFillAlt: "rgba(76, 56, 52, 0.96)",
          frontFill: "rgba(112, 84, 78, 0.96)",
          frontFillAlt: "rgba(96, 72, 67, 0.96)",
          bottomFill: "rgba(68, 48, 45, 0.94)",
          stroke: "rgba(255, 234, 222, 0.10)"
        }
      ));
      for (let index = 0; index < slatCount; index += 1) {
        const y0 = lerp(outerMin.y + 0.06, outerMax.y - 0.06, safeDiv(index + 0.3, slatCount + 0.2, 0));
        objects.push(createBoxObject(
          point(outerMin.x + 0.07, y0 - 0.016, outerMin.z - 0.005),
          point(outerMax.x - 0.07, y0 + 0.016, outerMax.z + 0.005),
          {
            topFill: "rgba(250, 241, 236, 0.95)",
            sideFill: "rgba(191, 160, 149, 0.96)",
            sideFillAlt: "rgba(173, 145, 135, 0.96)",
            frontFill: "rgba(224, 194, 183, 0.96)",
            frontFillAlt: "rgba(206, 176, 166, 0.96)",
            bottomFill: "rgba(160, 129, 121, 0.94)",
            stroke: "rgba(255,255,255,0.08)"
          }
        ));
      }
      return;
    }

    const plenumDepth = 0.14;
    let plenumMin = clonePoint(outerMin);
    let plenumMax = clonePoint(outerMax);
    if (orientation === "east") {
      plenumMin.x = outerMin.x - plenumDepth;
    } else if (orientation === "west") {
      plenumMax.x = outerMax.x + plenumDepth;
    } else if (orientation === "north") {
      plenumMin.y = outerMin.y - plenumDepth;
    } else if (orientation === "south") {
      plenumMax.y = outerMax.y + plenumDepth;
    }
    objects.push(createBoxObject(plenumMin, plenumMax, {
      topFill: "rgba(132, 104, 98, 0.95)",
      sideFill: "rgba(86, 63, 59, 0.96)",
      sideFillAlt: "rgba(76, 56, 52, 0.96)",
      frontFill: "rgba(112, 84, 78, 0.96)",
      frontFillAlt: "rgba(96, 72, 67, 0.96)",
      bottomFill: "rgba(68, 48, 45, 0.94)",
      stroke: "rgba(255, 234, 222, 0.10)"
    }));
    for (let index = 0; index < slatCount; index += 1) {
      const z0 = lerp(outerMin.z + 0.06, outerMax.z - 0.06, safeDiv(index + 0.3, slatCount + 0.2, 0));
      if (orientation === "east" || orientation === "west") {
        objects.push(createBoxObject(
          point(outerMin.x, outerMin.y + 0.06, z0 - 0.016),
          point(outerMax.x, outerMax.y - 0.06, z0 + 0.016),
          {
            topFill: "rgba(250, 241, 236, 0.95)",
            sideFill: "rgba(191, 160, 149, 0.96)",
            sideFillAlt: "rgba(173, 145, 135, 0.96)",
            frontFill: "rgba(224, 194, 183, 0.96)",
            frontFillAlt: "rgba(206, 176, 166, 0.96)",
            bottomFill: "rgba(160, 129, 121, 0.94)",
            stroke: "rgba(255,255,255,0.08)"
          }
        ));
      } else {
        objects.push(createBoxObject(
          point(outerMin.x + 0.06, outerMin.y, z0 - 0.016),
          point(outerMax.x - 0.06, outerMax.y, z0 + 0.016),
          {
            topFill: "rgba(250, 241, 236, 0.95)",
            sideFill: "rgba(191, 160, 149, 0.96)",
            sideFillAlt: "rgba(173, 145, 135, 0.96)",
            frontFill: "rgba(224, 194, 183, 0.96)",
            frontFillAlt: "rgba(206, 176, 166, 0.96)",
            bottomFill: "rgba(160, 129, 121, 0.94)",
            stroke: "rgba(255,255,255,0.08)"
          }
        ));
      }
    }
  }

  function faceListForBox(min, max, style) {
    const p000 = point(min.x, min.y, min.z);
    const p001 = point(min.x, min.y, max.z);
    const p010 = point(min.x, max.y, min.z);
    const p011 = point(min.x, max.y, max.z);
    const p100 = point(max.x, min.y, min.z);
    const p101 = point(max.x, min.y, max.z);
    const p110 = point(max.x, max.y, min.z);
    const p111 = point(max.x, max.y, max.z);

    return [
      { points: [p001, p101, p111, p011], fill: style.topFill, stroke: style.stroke },
      { points: [p000, p100, p101, p001], fill: style.frontFill, stroke: style.stroke },
      { points: [p100, p110, p111, p101], fill: style.sideFill, stroke: style.stroke },
      { points: [p010, p000, p001, p011], fill: style.sideFillAlt || style.sideFill, stroke: style.stroke },
      { points: [p110, p010, p011, p111], fill: style.frontFillAlt || style.frontFill, stroke: style.stroke },
      { points: [p000, p010, p110, p100], fill: style.bottomFill || style.frontFill, stroke: style.stroke }
    ];
  }

  function segmentPoint(points, progress) {
    if (!points || points.length === 0) {
      return point(0, 0, 0);
    }
    if (points.length === 1) {
      return clonePoint(points[0]);
    }

    const lengths = [];
    let totalLength = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const length = dist(points[index], points[index + 1]);
      lengths.push(length);
      totalLength += length;
    }
    if (totalLength <= 0.0001) {
      return clonePoint(points[0]);
    }

    let target = clamp(progress, 0, 0.999999) * totalLength;
    for (let index = 0; index < lengths.length; index += 1) {
      if (target <= lengths[index]) {
        const localT = safeDiv(target, lengths[index], 0);
        return point(
          lerp(points[index].x, points[index + 1].x, localT),
          lerp(points[index].y, points[index + 1].y, localT),
          lerp(points[index].z, points[index + 1].z, localT)
        );
      }
      target -= lengths[index];
    }

    return clonePoint(points[points.length - 1]);
  }

  function zoneFromName(zones, zoneName) {
    return (zones || []).find(function (zone) {
      return zone.name === zoneName;
    }) || null;
  }

  function zoneCenter(zone) {
    return point(
      (zone.x0 || 0) + (zone.length || 0) / 2,
      (zone.y0 || 0) + (zone.width || 0) / 2,
      0
    );
  }

  function pickZonePoints(points, zone) {
    return (points || []).filter(function (entry) {
      if (entry.zoneId) {
        return entry.zoneId === zone.id;
      }
      return entry.x >= zone.x0 - 0.01
        && entry.x <= zone.x0 + zone.length + 0.01
        && entry.y >= zone.y0 - 0.01
        && entry.y <= zone.y0 + zone.width + 0.01;
    });
  }

  function buildFallbackZone(result) {
    const length = parseFloat(result && result.inputs && result.inputs.len) || 10;
    const width = parseFloat(result && result.inputs && result.inputs.wid) || 8;
    return [{
      id: "zone-1",
      name: "Zone 1",
      row: 1,
      col: 1,
      x0: 0,
      y0: 0,
      length: length,
      width: width,
      area: roundTo(length * width, 2),
      conditionedCFM: result && result.cfm_conditioned ? result.cfm_conditioned : 0,
      processCFM: result && result.cfm_process_excess ? result.cfm_process_excess : 0,
      trFinal: result && result.tr_final ? result.tr_final : 0
    }];
  }

  function resolveClusters(result, zones) {
    if (result && result.zoneAhuStrategy && Array.isArray(result.zoneAhuStrategy.clusters) && result.zoneAhuStrategy.clusters.length) {
      return result.zoneAhuStrategy.clusters.map(function (cluster, index) {
        const selection = cluster.selection || {};
        const ahu = selection.ahu || {};
        return Object.assign({
          id: "cluster-" + (index + 1),
          name: cluster.name || ("AHU Cluster " + (index + 1)),
          zoneNames: cluster.zoneNames || zones.map(function (zone) { return zone.name; }),
          selection: selection,
          conditionedCFM: cluster.conditionedCFM || 0
        }, cluster, {
          deploymentCount: Math.max(
            ahu.unitCount || 0,
            ahu.airSectionCount || 0,
            ahu.coolingUnitCount || 0,
            1
          )
        });
      });
    }

    const selection = result && (result.equipmentSelection || (result.zoneAhuStrategy && result.zoneAhuStrategy.aggregateSelection)) || {};
    return [{
      id: "cluster-1",
      name: "Primary AHU",
      zoneNames: zones.map(function (zone) { return zone.name; }),
      selection: selection,
      conditionedCFM: result && result.cfm_conditioned ? result.cfm_conditioned : 0,
      deploymentCount: Math.max(
        (selection.ahu && selection.ahu.unitCount) || 0,
        (selection.ahu && selection.ahu.airSectionCount) || 0,
        (selection.ahu && selection.ahu.coolingUnitCount) || 0,
        1
      )
    }];
  }

  function buildScene(result) {
    const inputs = result && result.inputs ? result.inputs : {};
    const length = Math.max(parseFloat(inputs.len) || 10, 1);
    const width = Math.max(parseFloat(inputs.wid) || 8, 1);
    const height = Math.max(parseFloat(inputs.ht) || 3, 2.4);
    const occupiedZ = Math.min(1.8, Math.max(height * 0.42, 1.2));
    const ceilingZ = Math.max(height - 0.25, occupiedZ + 0.7);
    const baseServiceGap = clamp(Math.max(width * 0.08, 1.6), 1.6, 3.4);
    const zones = result && result.autoZoning && Array.isArray(result.autoZoning.zones) && result.autoZoning.zones.length
      ? result.autoZoning.zones
      : buildFallbackZone(result || {});
    const zoneDuctMap = {};
    (((result || {}).zoneDuctPlan || {}).zones || []).forEach(function (zoneDuct) {
      zoneDuctMap[zoneDuct.id] = zoneDuct;
    });

    const layout = (result || {}).diffuserLayout || {};
    const allSupplies = layout.supplies || [];
    const allReturns = (layout.returns && layout.returns.coords) || [];
    const branchSection = ductSection((result || {}).branch_duct, 0.18);
    const aggregateSupplySection = ductSection(result && result.ductStrategy && result.ductStrategy.supply && result.ductStrategy.supply.trunkDuct, 0.4);
    const aggregateReturnSection = ductSection(result && result.ductStrategy && result.ductStrategy.return && result.ductStrategy.return.trunkDuct, 0.34);
    const aggregateProcessSection = ductSection(result && result.ductStrategy && result.ductStrategy.process && result.ductStrategy.process.trunkDuct, 0.38);
    const clusters = resolveClusters(result || {}, zones);
    const clusterLayouts = [];
    let serviceDepthCursor = 0.4;

    clusters.forEach(function (cluster, clusterIndex) {
      const servedZones = (cluster.zoneNames || []).map(function (zoneName) {
        return zoneFromName(zones, zoneName);
      }).filter(Boolean);
      const zoneList = servedZones.length ? servedZones : zones;
      const centers = zoneList.map(zoneCenter);
      const centerX = centers.reduce(function (sum, entry) { return sum + entry.x; }, 0) / Math.max(centers.length, 1);
      const minX = Math.min.apply(null, centers.map(function (entry) { return entry.x; }).concat([centerX]));
      const maxX = Math.max.apply(null, centers.map(function (entry) { return entry.x; }).concat([centerX]));
      const moduleCount = Math.max(
        1,
        cluster.deploymentCount || 0,
        (cluster.selection && cluster.selection.ahu && cluster.selection.ahu.unitCount)
          || (cluster.selection && cluster.selection.ahu && cluster.selection.ahu.airSectionCount)
          || 0,
        (cluster.selection && cluster.selection.ahu && cluster.selection.ahu.coolingUnitCount)
          || (cluster.selection && cluster.selection.coolingUnitCount)
          || 1
      );
      const moduleWidth = clamp(Math.max((maxX - minX) * 0.42, 1.2), 1.2, 2.5);
      const moduleDepth = clamp(1.35 + safeDiv(cluster.conditionedCFM || 0, 18000, 0), 1.35, 2.3);
      const moduleHeight = clamp(height * 0.34, 1.3, 2.25);
      const moduleSpacingX = clamp(moduleWidth * 0.6, 0.8, 1.7);
      const moduleSpacingY = clamp(moduleDepth * 0.52, 0.72, 1.25);
      const sidePadding = 0.6;
      const availableLength = Math.max(length - sidePadding * 2, moduleWidth + 0.2);
      const maxColumns = Math.max(1, Math.floor((availableLength + moduleSpacingX) / (moduleWidth + moduleSpacingX)));
      const columnCount = Math.max(1, Math.min(moduleCount, maxColumns));
      const rowCount = Math.max(1, Math.ceil(moduleCount / columnCount));
      const rowBandDepth = rowCount * moduleDepth + Math.max(0, rowCount - 1) * moduleSpacingY;
      const clusterGapY = clusterIndex > 0 ? 0.75 : 0;
      serviceDepthCursor += clusterGapY;

      const modulePositions = [];
      for (let rowIndex = 0, placed = 0; rowIndex < rowCount; rowIndex += 1) {
        const remaining = moduleCount - placed;
        const itemsInRow = Math.min(columnCount, remaining);
        const rowWidth = itemsInRow * moduleWidth + Math.max(0, itemsInRow - 1) * moduleSpacingX;
        const rowCenterX = clamp(centerX, rowWidth / 2 + sidePadding, length - rowWidth / 2 - sidePadding);
        const rowStartX = rowCenterX - rowWidth / 2 + moduleWidth / 2;
        const rowCenterY = -(serviceDepthCursor + moduleDepth / 2 + rowIndex * (moduleDepth + moduleSpacingY));
        for (let colIndex = 0; colIndex < itemsInRow; colIndex += 1, placed += 1) {
          modulePositions.push({
            x: rowStartX + colIndex * (moduleWidth + moduleSpacingX),
            y: rowCenterY,
            index: placed + 1
          });
        }
      }

      serviceDepthCursor += rowBandDepth;
      clusterLayouts.push({
        cluster: cluster,
        zoneList: zoneList,
        centerX: centerX,
        moduleCount: moduleCount,
        moduleWidth: moduleWidth,
        moduleDepth: moduleDepth,
        moduleHeight: moduleHeight,
        modulePositions: modulePositions,
        headerAnchorX: modulePositions.reduce(function (sum, entry) { return sum + entry.x; }, 0) / Math.max(modulePositions.length, 1),
        headerAnchorY: modulePositions.reduce(function (maxValue, entry) { return Math.max(maxValue, entry.y); }, -Infinity) + moduleDepth / 2,
        labelY: modulePositions.reduce(function (sum, entry) { return sum + entry.y; }, 0) / Math.max(modulePositions.length, 1)
      });
    });
    const serviceGap = Math.max(baseServiceGap, serviceDepthCursor + 0.8);
    const scene = {
      room: {
        length: length,
        width: width,
        height: height,
        occupiedZ: occupiedZ,
        ceilingZ: ceilingZ,
        serviceGap: serviceGap
      },
      center: point(length / 2, width / 2, height / 2),
      objects: [],
      labels: [],
      particles: [],
      callouts: [],
      supplyColor: "#63b8ff",
      returnColor: "#ff8d7b"
    };

    zones.forEach(function (zone) {
      const center = zoneCenter(zone);
      scene.labels.push({
        point: point(center.x, center.y, 0.16),
        text: zone.name,
        color: "rgba(183, 199, 226, 0.88)",
        font: "11px IBM Plex Mono"
      });
    });

    clusterLayouts.forEach(function (clusterLayout, clusterIndex) {
      const cluster = clusterLayout.cluster;
      const zoneList = clusterLayout.zoneList;
      const moduleCount = clusterLayout.moduleCount;
      const moduleWidth = clusterLayout.moduleWidth;
      const moduleDepth = clusterLayout.moduleDepth;
      const moduleHeight = clusterLayout.moduleHeight;
      const headerAnchorX = clusterLayout.headerAnchorX;
      const headerAnchorY = clusterLayout.headerAnchorY;
      const ahuTopZ = moduleHeight * 0.76;
      const ahuInletZ = moduleHeight * 0.48;
      const supplySpineZ = Math.max(ceilingZ - 0.18, occupiedZ + 0.8);
      const returnSpineZ = Math.max(ceilingZ - 0.48, occupiedZ + 0.6);
      const processRoofZ = height + 0.35;

      clusterLayout.modulePositions.forEach(function (position) {
        const moduleCenterX = position.x;
        const moduleCenterY = position.y;
        const min = point(
          moduleCenterX - moduleWidth / 2,
          moduleCenterY - moduleDepth / 2,
          0
        );
        const max = point(
          moduleCenterX + moduleWidth / 2,
          moduleCenterY + moduleDepth / 2,
          moduleHeight
        );
        addAhuUnit(scene.objects, min, max);
        scene.labels.push({
          point: point(moduleCenterX, moduleCenterY, moduleHeight + 0.1),
          text: cluster.name + " · AHU " + position.index,
          color: "rgba(233, 240, 252, 0.98)",
          font: "10px IBM Plex Mono"
        });
      });

      scene.labels.push({
        point: point(headerAnchorX, clusterLayout.labelY, moduleHeight + 0.24),
        text: cluster.name + " (" + moduleCount + " AHU" + (moduleCount > 1 ? "s" : "") + ")",
        color: LABEL_COLOR,
        font: "12px IBM Plex Mono"
      });

      const supplyHeaderPath = [
        point(headerAnchorX, headerAnchorY, ahuTopZ),
        point(headerAnchorX, 0, ahuTopZ),
        point(headerAnchorX, 0, supplySpineZ)
      ];
      addClosedPolylineBoxes(scene.objects, supplyHeaderPath, aggregateSupplySection, {
        topFill: SUPPLY_TOP,
        sideFill: SUPPLY_SIDE,
        sideFillAlt: "rgba(18, 66, 116, 0.99)",
        frontFill: SUPPLY_FRONT,
        frontFillAlt: "rgba(30, 94, 159, 0.99)",
        bottomFill: "rgba(16, 49, 92, 0.98)",
        stroke: "rgba(180, 226, 255, 0.28)"
      });

      const returnHeaderPath = [
        point(headerAnchorX, 0, returnSpineZ),
        point(headerAnchorX, headerAnchorY, returnSpineZ),
        point(headerAnchorX, headerAnchorY, ahuInletZ)
      ];
      addClosedPolylineBoxes(scene.objects, returnHeaderPath, aggregateReturnSection, {
        topFill: RETURN_TOP,
        sideFill: RETURN_SIDE,
        sideFillAlt: "rgba(130, 71, 76, 0.99)",
        frontFill: RETURN_FRONT,
        frontFillAlt: "rgba(160, 90, 84, 0.99)",
        bottomFill: "rgba(120, 64, 70, 0.98)",
        stroke: "rgba(255, 225, 219, 0.28)"
      });

      zoneList.forEach(function (zone) {
        const zoneCenterPoint = zoneCenter(zone);
        const zoneDuct = zoneDuctMap[zone.id] || {};
        const zoneSupplySection = ductSection(zoneDuct.supply && zoneDuct.supply.trunkDuct, aggregateSupplySection.width);
        const zoneReturnSection = ductSection(zoneDuct.return && zoneDuct.return.trunkDuct, aggregateReturnSection.width);
        const zoneSupplies = pickZonePoints(allSupplies, zone);
        const zoneReturns = pickZonePoints(allReturns, zone);
        const returnType = (((layout.returns || {}).type) || "").toLowerCase();
        const highWallReturn = returnType.indexOf("high-wall") !== -1;
        const zoneReturnY = zoneReturns.length
          ? roundTo(zoneReturns.reduce(function (sum, entry) { return sum + entry.y; }, 0) / zoneReturns.length, 2)
          : roundTo(zone.y0 + zone.width * 0.9, 2);
        const supplyTerminalZ = ceilingZ;

        const supplyPath = [
          point(headerAnchorX, 0, supplySpineZ),
          point(zoneCenterPoint.x, 0, supplySpineZ),
          point(zoneCenterPoint.x, zoneCenterPoint.y, supplySpineZ)
        ];
        addClosedPolylineBoxes(scene.objects, supplyPath, zoneSupplySection, {
          topFill: SUPPLY_TOP,
          sideFill: SUPPLY_SIDE,
          sideFillAlt: "rgba(18, 66, 116, 0.99)",
          frontFill: SUPPLY_FRONT,
          frontFillAlt: "rgba(30, 94, 159, 0.99)",
          bottomFill: "rgba(16, 49, 92, 0.98)",
          stroke: "rgba(180, 226, 255, 0.28)"
        });
        scene.particles.push({
          points: supplyPath.concat([point(zoneCenterPoint.x, zoneCenterPoint.y, occupiedZ + 0.18)]),
          color: "#63b8ff",
          count: zoneSupplies.length > 10 ? 4 : 3,
          speed: 0.09,
          radius: 4.4
        });

        if (zoneSupplies.length) {
          const branchStep = zoneSupplies.length > 24 ? 2 : 1;
          zoneSupplies.forEach(function (supplyPoint, supplyIndex) {
            addDiffuserAssembly(scene.objects, supplyPoint, supplyTerminalZ);
            scene.particles.push({
              points: [
                point(supplyPoint.x, supplyPoint.y, supplyTerminalZ - 0.01),
                point(supplyPoint.x, supplyPoint.y, Math.max(occupiedZ, 0.9))
              ],
              color: "#66d1ff",
              count: 2,
              speed: 0.12 + (supplyIndex % 3) * 0.01,
              radius: 3.2
            });
            if (supplyIndex % branchStep === 0) {
              const branchPoints = [
                point(zoneCenterPoint.x, zoneCenterPoint.y, supplySpineZ),
                point(supplyPoint.x, zoneCenterPoint.y, supplySpineZ),
                point(supplyPoint.x, supplyPoint.y, supplySpineZ),
                point(supplyPoint.x, supplyPoint.y, supplyTerminalZ)
              ];
              addClosedPolylineBoxes(scene.objects, branchPoints, branchSection, {
                topFill: "rgba(78, 188, 255, 0.95)",
                sideFill: "rgba(23, 75, 129, 0.98)",
                sideFillAlt: "rgba(18, 61, 104, 0.98)",
                frontFill: "rgba(52, 128, 200, 0.98)",
                frontFillAlt: "rgba(42, 108, 176, 0.98)",
                bottomFill: "rgba(14, 44, 84, 0.96)",
                stroke: "rgba(180, 226, 255, 0.24)"
              });
            }
          });
        } else {
          scene.particles.push({
            points: [
              point(zoneCenterPoint.x, zoneCenterPoint.y, supplySpineZ),
              point(zoneCenterPoint.x, zoneCenterPoint.y, Math.max(occupiedZ, 0.9))
            ],
            color: "#66d1ff",
            count: 2,
            speed: 0.12,
            radius: 3.2
          });
        }

        const collectorPoint = point(zoneCenterPoint.x, zoneReturnY, returnSpineZ);
        const returnPath = [
          collectorPoint,
          point(headerAnchorX, zoneReturnY, returnSpineZ),
          point(headerAnchorX, 0, returnSpineZ)
        ];
        addClosedPolylineBoxes(scene.objects, returnPath, zoneReturnSection, {
          topFill: RETURN_TOP,
          sideFill: RETURN_SIDE,
          sideFillAlt: "rgba(130, 71, 76, 0.99)",
          frontFill: RETURN_FRONT,
          frontFillAlt: "rgba(160, 90, 84, 0.99)",
          bottomFill: "rgba(120, 64, 70, 0.98)",
          stroke: "rgba(255, 225, 219, 0.28)"
        });
        scene.particles.push({
          points: [
            point(zoneCenterPoint.x, zoneCenterPoint.y, Math.max(occupiedZ, 0.9)),
            collectorPoint
          ].concat(returnPath.slice(1)),
          color: "#ff9b84",
          count: zoneReturns.length > 1 ? 3 : 2,
          speed: 0.08,
          radius: 4.0
        });

        zoneReturns.forEach(function (returnPoint, returnIndex) {
          const wallTolerance = Math.min(zone.length, zone.width) * 0.14;
          const nearEastWall = Math.abs(returnPoint.x - (zone.x0 + zone.length)) <= wallTolerance;
          const nearWestWall = Math.abs(returnPoint.x - zone.x0) <= wallTolerance;
          const nearNorthWall = Math.abs(returnPoint.y - (zone.y0 + zone.width)) <= wallTolerance;
          const nearSouthWall = Math.abs(returnPoint.y - zone.y0) <= wallTolerance;
          const returnZ = highWallReturn
            ? Math.min(height - 0.4, Math.max(height * 0.78, occupiedZ + 1.2))
            : ceilingZ - 0.02;
          const wallDepth = 0.035;
          let grilleMin;
          let grilleMax;
          let grilleOrientation = "ceiling";
          if (highWallReturn && (nearEastWall || nearWestWall)) {
            const xFace = nearEastWall ? zone.x0 + zone.length : zone.x0;
            grilleMin = point(xFace - (nearEastWall ? wallDepth : 0), returnPoint.y - 0.32, returnZ - 0.25);
            grilleMax = point(xFace + (nearEastWall ? 0 : wallDepth), returnPoint.y + 0.32, returnZ + 0.25);
            grilleOrientation = nearEastWall ? "east" : "west";
          } else if (highWallReturn && (nearNorthWall || nearSouthWall)) {
            const yFace = nearNorthWall ? zone.y0 + zone.width : zone.y0;
            grilleMin = point(returnPoint.x - 0.32, yFace - (nearNorthWall ? wallDepth : 0), returnZ - 0.25);
            grilleMax = point(returnPoint.x + 0.32, yFace + (nearNorthWall ? 0 : wallDepth), returnZ + 0.25);
            grilleOrientation = nearNorthWall ? "north" : "south";
          } else {
            grilleMin = point(returnPoint.x - 0.18, returnPoint.y - 0.18, returnZ - 0.04);
            grilleMax = point(returnPoint.x + 0.18, returnPoint.y + 0.18, returnZ + 0.01);
          }
          addReturnGrilleAssembly(scene.objects, grilleMin, grilleMax, grilleOrientation);
          if (returnIndex % 2 === 0) {
            const returnBranchPoints = [
              collectorPoint,
              point(returnPoint.x, collectorPoint.y, returnSpineZ),
              point(returnPoint.x, returnPoint.y, returnSpineZ),
              point(returnPoint.x, returnPoint.y, returnZ)
            ];
            addClosedPolylineBoxes(scene.objects, returnBranchPoints, branchSection, {
              topFill: "rgba(255, 174, 121, 0.95)",
              sideFill: "rgba(128, 72, 78, 0.98)",
              sideFillAlt: "rgba(112, 63, 69, 0.98)",
              frontFill: "rgba(190, 108, 95, 0.98)",
              frontFillAlt: "rgba(166, 95, 84, 0.98)",
              bottomFill: "rgba(99, 55, 61, 0.96)",
              stroke: "rgba(255, 225, 219, 0.24)"
            });
          }
          if (returnIndex < 4) {
            scene.particles.push({
              points: [
                point(returnPoint.x, returnPoint.y, Math.max(occupiedZ, 0.9)),
                point(returnPoint.x, returnPoint.y, returnZ)
              ],
              color: "#ffb090",
              count: 1,
              speed: 0.06 + returnIndex * 0.01,
              radius: 2.8
            });
          }
        });

        if (zoneDuct.process && zoneDuct.process.distributed && zone.processCFM > 0) {
          const processDevices = Math.max(zoneDuct.process.deviceCount || 1, 1);
          const deviceSpacing = zone.length / Math.max(processDevices + 1, 2);
          for (let deviceIndex = 0; deviceIndex < processDevices; deviceIndex += 1) {
            const exhaustX = zone.x0 + deviceSpacing * (deviceIndex + 1);
            const exhaustY = zone.y0 + Math.min(zone.width * 0.12, 1.2);
            const exhaustBase = point(exhaustX, exhaustY, height - 0.4);
            scene.objects.push(createBoxObject(
              point(exhaustX - 0.12, exhaustY - 0.12, height - 0.52),
              point(exhaustX + 0.12, exhaustY + 0.12, height - 0.18),
              {
                topFill: PROCESS_TOP,
                sideFill: PROCESS_SIDE,
                sideFillAlt: "rgba(119, 82, 26, 0.98)",
                frontFill: PROCESS_FRONT,
                frontFillAlt: "rgba(154, 103, 30, 0.98)",
                bottomFill: "rgba(103, 72, 22, 0.92)",
                stroke: "rgba(255, 228, 182, 0.16)"
              }
            ));
            scene.particles.push({
              points: [
                point(zoneCenterPoint.x, zoneCenterPoint.y, Math.max(occupiedZ, 0.9)),
                exhaustBase,
                point(exhaustX, exhaustY, processRoofZ)
              ],
              color: "#ffb36e",
              count: 2,
              speed: 0.07,
              radius: 3.4
            });
          }
        }
      });
    });

    scene.callouts.push({
      point: point(length * 0.5, width + 0.18, height + 0.14),
      text: roundTo(length, 2) + " m x " + roundTo(width, 2) + " m x " + roundTo(height, 2) + " m room envelope"
    });

    return scene;
  }

  function ensureInstance(canvas) {
    if (instances.has(canvas)) {
      return instances.get(canvas);
    }

    const ctx = canvas.getContext("2d");
    const instance = {
      canvas: canvas,
      ctx: ctx,
      scene: null,
      width: canvas.clientWidth || 960,
      height: canvas.clientHeight || 540,
      dpr: Math.max(window.devicePixelRatio || 1, 1),
      rafId: 0,
      state: {
        yaw: DEFAULT_YAW,
        pitch: DEFAULT_PITCH,
        zoom: DEFAULT_ZOOM,
        projection: "perspective",
        panX: 0,
        panY: 0,
        time: 0,
        targetYaw: null,
        targetPitch: null,
        targetZoom: null,
        targetProjection: null,
        activeView: "iso"
      },
      drag: null,
      cubeDrag: null,
      lastFrame: 0,
      resizeObserver: null,
      viewButtons: [],
      viewCube: null,
      viewCubeScene: null,
      suppressCubeClick: false
    };

    function syncViewButtons() {
      instance.viewButtons.forEach(function (button) {
        button.classList.toggle("is-active", button.getAttribute("data-view") === instance.state.activeView);
      });
    }

    function syncViewCube() {
      if (!instance.viewCube) {
        return;
      }
      const rotationX = roundTo((-instance.state.pitch * 180 / Math.PI), 2);
      const rotationZ = roundTo((instance.state.yaw * 180 / Math.PI), 2);
      instance.viewCube.style.transform = "rotateX(" + rotationX + "deg) rotateZ(" + rotationZ + "deg)";
    }

    function setView(viewName) {
      const preset = VIEW_PRESETS[viewName] || VIEW_PRESETS.iso;
      instance.state.targetYaw = preset.yaw;
      instance.state.targetPitch = preset.pitch;
      instance.state.targetZoom = preset.zoom;
      instance.state.targetProjection = preset.projection || "perspective";
      instance.state.panX = 0;
      instance.state.panY = 0;
      instance.state.activeView = VIEW_PRESETS[viewName] ? viewName : "iso";
      syncViewButtons();
      syncViewCube();
    }

    function resizeCanvas() {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(Math.round(rect.width || 960), 320);
      const nextHeight = Math.max(Math.round(rect.height || 540), 240);
      const nextDpr = Math.max(window.devicePixelRatio || 1, 1);
      if (instance.width === nextWidth && instance.height === nextHeight && instance.dpr === nextDpr) {
        return;
      }
      instance.width = nextWidth;
      instance.height = nextHeight;
      instance.dpr = nextDpr;
      canvas.width = Math.round(nextWidth * nextDpr);
      canvas.height = Math.round(nextHeight * nextDpr);
    }

    function startDrag(event) {
      instance.drag = {
        x: event.clientX,
        y: event.clientY,
        yaw: instance.state.yaw,
        pitch: instance.state.pitch
      };
      canvas.classList.add("is-dragging");
    }

    function moveDrag(event) {
      if (!instance.drag) {
        return;
      }
      const dx = event.clientX - instance.drag.x;
      const dy = event.clientY - instance.drag.y;
      instance.state.targetYaw = null;
      instance.state.targetPitch = null;
      instance.state.targetZoom = null;
      instance.state.targetProjection = null;
      instance.state.projection = "perspective";
      instance.state.activeView = null;
      syncViewButtons();
      instance.state.yaw = instance.drag.yaw + dx * 0.008;
      instance.state.pitch = clamp(instance.drag.pitch + dy * 0.006, MIN_PITCH, MAX_PITCH);
      syncViewCube();
    }

    function endDrag() {
      instance.drag = null;
      canvas.classList.remove("is-dragging");
    }

    canvas.addEventListener("pointerdown", function (event) {
      canvas.setPointerCapture(event.pointerId);
      startDrag(event);
    });
    canvas.addEventListener("pointermove", moveDrag);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", endDrag);
    canvas.addEventListener("wheel", function (event) {
      event.preventDefault();
      instance.state.targetZoom = null;
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      instance.state.zoom = clamp(instance.state.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    }, { passive: false });
    canvas.addEventListener("dblclick", function () {
      setView("iso");
    });
    if (canvas.parentElement) {
      canvas.parentElement.addEventListener("dblclick", function (event) {
        if (event.target && event.target.closest && event.target.closest("[data-viewcube-scene], [data-view], .schematic-orbit-tip")) {
          return;
        }
        setView("iso");
      });
    }

    instance.viewCube = (canvas.parentElement || document).querySelector("[data-viewcube]");
    instance.viewCubeScene = (canvas.parentElement || document).querySelector("[data-viewcube-scene]");
    instance.viewButtons = Array.prototype.slice.call((canvas.parentElement || document).querySelectorAll("[data-view]"));
    instance.viewButtons.forEach(function (button) {
      button.addEventListener("pointerdown", function (event) {
        event.stopPropagation();
      });
      button.addEventListener("click", function () {
        if (instance.suppressCubeClick) {
          instance.suppressCubeClick = false;
          return;
        }
        setView(button.getAttribute("data-view"));
      });
    });

    function startCubeDrag(event) {
      if (!instance.viewCubeScene) {
        return;
      }
      instance.cubeDrag = {
        x: event.clientX,
        y: event.clientY,
        yaw: instance.state.yaw,
        pitch: instance.state.pitch,
        moved: false,
        viewName: event.target && event.target.closest ? (event.target.closest("[data-view]") && event.target.closest("[data-view]").getAttribute("data-view")) : null
      };
      instance.viewCubeScene.classList.add("is-dragging");
    }

    function moveCubeDrag(event) {
      if (!instance.cubeDrag) {
        return;
      }
      const dx = event.clientX - instance.cubeDrag.x;
      const dy = event.clientY - instance.cubeDrag.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        instance.cubeDrag.moved = true;
        instance.cubeDrag.viewName = null;
      }
      instance.state.targetYaw = null;
      instance.state.targetPitch = null;
      instance.state.targetZoom = null;
      instance.state.targetProjection = null;
      instance.state.projection = "perspective";
      instance.state.activeView = null;
      syncViewButtons();
      instance.state.yaw = instance.cubeDrag.yaw + dx * 0.012;
      instance.state.pitch = clamp(instance.cubeDrag.pitch + dy * 0.009, MIN_PITCH, MAX_PITCH);
      syncViewCube();
    }

    function endCubeDrag() {
      if (!instance.cubeDrag) {
        return;
      }
      const selectedView = !instance.cubeDrag.moved ? instance.cubeDrag.viewName : null;
      instance.suppressCubeClick = !!instance.cubeDrag.moved;
      if (instance.viewCubeScene) {
        instance.viewCubeScene.classList.remove("is-dragging");
      }
      instance.cubeDrag = null;
      if (selectedView) {
        setView(selectedView);
      }
      window.setTimeout(function () {
        instance.suppressCubeClick = false;
      }, 0);
    }

    if (instance.viewCubeScene) {
      instance.viewCubeScene.addEventListener("pointerdown", function (event) {
        instance.viewCubeScene.setPointerCapture(event.pointerId);
        startCubeDrag(event);
      });
      instance.viewCubeScene.addEventListener("pointermove", moveCubeDrag);
      instance.viewCubeScene.addEventListener("pointerup", endCubeDrag);
      instance.viewCubeScene.addEventListener("pointercancel", endCubeDrag);
      instance.viewCubeScene.addEventListener("pointerleave", endCubeDrag);
    }

    syncViewButtons();
    syncViewCube();

    instance.resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(resizeCanvas)
      : null;
    if (instance.resizeObserver) {
      instance.resizeObserver.observe(canvas);
    }
    resizeCanvas();
    instances.set(canvas, instance);
    return instance;
  }

  function projectPoint(instance, scene, source) {
    const local = subPoint(source, scene.center);
    const cosYaw = Math.cos(instance.state.yaw);
    const sinYaw = Math.sin(instance.state.yaw);
    const cosPitch = Math.cos(instance.state.pitch);
    const sinPitch = Math.sin(instance.state.pitch);
    const yawX = local.x * cosYaw - local.y * sinYaw;
    const yawY = local.x * sinYaw + local.y * cosYaw;
    const yawZ = local.z;
    const pitchY = yawY * cosPitch - yawZ * sinPitch;
    const pitchZ = yawY * sinPitch + yawZ * cosPitch;
    const sceneSpan = Math.max(scene.room.length, scene.room.width, scene.room.height + scene.room.serviceGap);
    const orthographic = instance.state.projection === "orthographic";
    const activeView = instance.state.activeView || "iso";
    let horizontalSpan = Math.max(scene.room.length + scene.room.width * 0.35 + scene.room.serviceGap * 1.2, 1);
    let verticalSpan = Math.max(scene.room.height + scene.room.width * 0.8 + 2.6, 1);
    if (orthographic) {
      if (activeView === "front" || activeView === "back") {
        horizontalSpan = scene.room.length + 1.4;
        verticalSpan = scene.room.height + 1.8;
      } else if (activeView === "left" || activeView === "right") {
        horizontalSpan = scene.room.width + 1.4;
        verticalSpan = scene.room.height + 1.8;
      } else if (activeView === "top" || activeView === "bottom") {
        horizontalSpan = Math.max(scene.room.length, scene.room.width) + 1.6;
        verticalSpan = Math.max(scene.room.length, scene.room.width) + 1.6;
      } else {
        horizontalSpan = Math.max(scene.room.length, scene.room.width) + 1.6;
        verticalSpan = scene.room.height + 1.8;
      }
    }
    const scale = Math.min(instance.width / Math.max(horizontalSpan, 1), instance.height / Math.max(verticalSpan, 1)) * (orthographic ? 0.9 : 0.82);
    const cameraDistance = sceneSpan * 2.4 + 4.5;
    const perspective = orthographic ? 1 : cameraDistance / Math.max(cameraDistance + pitchY, 0.5);
    const verticalOffset = orthographic ? 14 : 34;
    return {
      x: instance.width / 2 + (yawX * scale * perspective * instance.state.zoom) + instance.state.panX,
      y: instance.height / 2 - (pitchZ * scale * perspective * instance.state.zoom) + verticalOffset + instance.state.panY,
      depth: pitchY,
      perspective: perspective
    };
  }

  function drawPolygon(ctx, projectedPoints, fill, stroke, lineWidth) {
    if (!projectedPoints.length) {
      return;
    }
    ctx.beginPath();
    ctx.moveTo(projectedPoints[0].x, projectedPoints[0].y);
    for (let index = 1; index < projectedPoints.length; index += 1) {
      ctx.lineTo(projectedPoints[index].x, projectedPoints[index].y);
    }
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = lineWidth || 1;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function drawRoom(instance, scene) {
    const ctx = instance.ctx;
    const room = scene.room;
    const floor = [
      point(0, 0, 0),
      point(room.length, 0, 0),
      point(room.length, room.width, 0),
      point(0, room.width, 0)
    ];
    const ceiling = floor.map(function (entry) {
      return point(entry.x, entry.y, room.height);
    });
    const wallA = [floor[0], floor[1], ceiling[1], ceiling[0]];
    const wallB = [floor[1], floor[2], ceiling[2], ceiling[1]];
    const wallC = [floor[2], floor[3], ceiling[3], ceiling[2]];
    const wallD = [floor[3], floor[0], ceiling[0], ceiling[3]];

    const faces = [
      { points: floor, fill: FLOOR_FILL, stroke: ROOM_STROKE },
      { points: wallA, fill: ROOM_FILL, stroke: ROOM_STROKE },
      { points: wallB, fill: ROOM_FILL, stroke: ROOM_STROKE },
      { points: wallC, fill: ROOM_FILL, stroke: ROOM_STROKE },
      { points: wallD, fill: ROOM_FILL, stroke: ROOM_STROKE },
      { points: ceiling, fill: "rgba(84, 108, 148, 0.02)", stroke: "rgba(166, 188, 222, 0.32)" }
    ];

    const projectedFaces = faces.map(function (face) {
      const projected = face.points.map(function (entry) {
        return projectPoint(instance, scene, entry);
      });
      return {
        projected: projected,
        fill: face.fill,
        stroke: face.stroke,
        depth: projected.reduce(function (sum, entry) { return sum + entry.depth; }, 0) / projected.length
      };
    }).sort(function (left, right) {
      return left.depth - right.depth;
    });

    projectedFaces.forEach(function (face) {
      drawPolygon(ctx, face.projected, face.fill, face.stroke, 1.2);
    });

    const gridSpacing = Math.max(2, Math.round(Math.min(room.length, room.width) / 8));
    for (let x = 0; x <= room.length + 0.001; x += gridSpacing) {
      const start = projectPoint(instance, scene, point(x, 0, 0.01));
      const end = projectPoint(instance, scene, point(x, room.width, 0.01));
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (let y = 0; y <= room.width + 0.001; y += gridSpacing) {
      const start = projectPoint(instance, scene, point(0, y, 0.01));
      const end = projectPoint(instance, scene, point(room.length, y, 0.01));
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = GRID_COLOR;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawObjects(instance, scene) {
    const ctx = instance.ctx;
    const faces = [];

    scene.objects.forEach(function (object) {
      if (object.kind !== "box") {
        return;
      }
      faceListForBox(object.min, object.max, object.style).forEach(function (face) {
        const projected = face.points.map(function (entry) {
          return projectPoint(instance, scene, entry);
        });
        faces.push({
          projected: projected,
          fill: face.fill,
          stroke: face.stroke,
          depth: projected.reduce(function (sum, entry) { return sum + entry.depth; }, 0) / projected.length
        });
      });
    });

    faces.sort(function (left, right) {
      return left.depth - right.depth;
    });

    faces.forEach(function (face) {
      drawPolygon(ctx, face.projected, face.fill, face.stroke, 1);
    });
  }

  function drawCloudPuff(ctx, x, y, radius, color, alpha, rotation, stretch) {
    const safeRadius = Math.max(radius, 1.2);
    const safeStretch = Math.max(stretch, 0.55);
    const outerRadius = safeRadius * 2.1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.scale(1, safeStretch);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, outerRadius);
    gradient.addColorStop(0, colorWithAlpha(color, alpha));
    gradient.addColorStop(0.35, colorWithAlpha(color, alpha * 0.82));
    gradient.addColorStop(0.7, colorWithAlpha(color, alpha * 0.28));
    gradient.addColorStop(1, colorWithAlpha(color, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, outerRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCloudParticle(ctx, path, projected, radius, angle, phase, index) {
    const baseRadius = Math.max(radius, 1.7);
    const drift = Math.sin(phase + index * 0.9) * baseRadius * 0.16;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const normalX = -directionY;
    const normalY = directionX;
    const lobes = [
      { along: -0.55, cross: 0, scale: 1.65, alpha: 0.30, stretch: 0.74 },
      { along: -0.05, cross: -0.26, scale: 1.18, alpha: 0.24, stretch: 0.70 },
      { along: 0.12, cross: 0.28, scale: 1.12, alpha: 0.22, stretch: 0.68 },
      { along: 0.44, cross: -0.12, scale: 0.96, alpha: 0.18, stretch: 0.65 },
      { along: 0.50, cross: 0.20, scale: 0.90, alpha: 0.15, stretch: 0.62 }
    ];

    lobes.forEach(function (lobe, lobeIndex) {
      const seed = seededUnit((index + 1) * (lobeIndex + 2) * 0.37 + path.speed * 10);
      const along = (lobe.along + (seed - 0.5) * 0.08) * baseRadius * 2.1;
      const cross = (lobe.cross + Math.sin(phase * 0.8 + lobeIndex) * 0.03) * baseRadius * 1.8;
      const x = projected.x + directionX * along + normalX * cross + directionX * drift * 0.35;
      const y = projected.y + directionY * along + normalY * cross + normalY * drift;
      const lobeRotation = angle + (seed - 0.5) * 0.35;
      drawCloudPuff(
        ctx,
        x,
        y,
        baseRadius * lobe.scale,
        path.color,
        lobe.alpha,
        lobeRotation,
        lobe.stretch + seed * 0.08
      );
    });

    drawCloudPuff(
      ctx,
      projected.x - directionX * baseRadius * 0.35,
      projected.y - directionY * baseRadius * 0.35,
      baseRadius * 1.2,
      path.color,
      0.12,
      angle,
      0.84
    );
  }

  function drawParticles(instance, scene) {
    const ctx = instance.ctx;
    scene.particles.forEach(function (path) {
      for (let index = 0; index < path.count; index += 1) {
        const progress = ((instance.state.time * path.speed) + safeDiv(index, path.count, 0)) % 1;
        const worldPoint = segmentPoint(path.points, progress);
        const projected = projectPoint(instance, scene, worldPoint);
        const radius = path.radius * projected.perspective;
        const prevPoint = segmentPoint(path.points, Math.max(progress - 0.016, 0));
        const nextPoint = segmentPoint(path.points, Math.min(progress + 0.016, 0.999));
        const prevProjected = projectPoint(instance, scene, prevPoint);
        const nextProjected = projectPoint(instance, scene, nextPoint);
        const angle = Math.atan2(nextProjected.y - prevProjected.y, nextProjected.x - prevProjected.x) || 0;
        const phase = instance.state.time * 3.2 + index * 1.17 + path.speed * 9;
        drawCloudParticle(ctx, path, projected, radius, angle, phase, index);
      }
    });
  }

  function drawLabels(instance, scene) {
    const ctx = instance.ctx;
    scene.labels.concat(scene.callouts).forEach(function (label) {
      const projected = projectPoint(instance, scene, label.point);
      ctx.font = label.font || "11px IBM Plex Mono";
      ctx.fillStyle = label.color || LABEL_COLOR;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(6, 10, 16, 0.78)";
      ctx.strokeText(label.text, projected.x, projected.y);
      ctx.fillText(label.text, projected.x, projected.y);
    });
  }

  function drawPlaceholder(instance) {
    const ctx = instance.ctx;
    ctx.setTransform(instance.dpr, 0, 0, instance.dpr, 0, 0);
    ctx.clearRect(0, 0, instance.width, instance.height);
    const gradient = ctx.createLinearGradient(0, 0, 0, instance.height);
    gradient.addColorStop(0, "#111827");
    gradient.addColorStop(1, "#090d14");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, instance.width, instance.height);
    ctx.fillStyle = "rgba(187, 198, 220, 0.9)";
    ctx.font = "600 22px Syne, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("3D HVAC schematic will appear after calculation", instance.width / 2, instance.height / 2 - 6);
    ctx.fillStyle = "rgba(140, 153, 180, 0.86)";
    ctx.font = "12px IBM Plex Mono, monospace";
    ctx.fillText("Visualization only - geometry follows the active room result.", instance.width / 2, instance.height / 2 + 24);
  }

  function drawFrame(instance) {
    const ctx = instance.ctx;
    if (!instance.scene) {
      drawPlaceholder(instance);
      return;
    }

    ctx.setTransform(instance.dpr, 0, 0, instance.dpr, 0, 0);
    ctx.clearRect(0, 0, instance.width, instance.height);

    const gradient = ctx.createLinearGradient(0, 0, 0, instance.height);
    gradient.addColorStop(0, "#0d1728");
    gradient.addColorStop(0.58, "#0a1322");
    gradient.addColorStop(1, "#070d17");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, instance.width, instance.height);

    const coolGlow = ctx.createRadialGradient(instance.width * 0.18, instance.height * 0.12, 0, instance.width * 0.18, instance.height * 0.12, instance.width * 0.42);
    coolGlow.addColorStop(0, "rgba(73, 170, 255, 0.22)");
    coolGlow.addColorStop(1, "rgba(73, 170, 255, 0)");
    ctx.fillStyle = coolGlow;
    ctx.fillRect(0, 0, instance.width, instance.height);

    const warmGlow = ctx.createRadialGradient(instance.width * 0.84, instance.height * 0.22, 0, instance.width * 0.84, instance.height * 0.22, instance.width * 0.34);
    warmGlow.addColorStop(0, "rgba(255, 146, 107, 0.14)");
    warmGlow.addColorStop(1, "rgba(255, 146, 107, 0)");
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, 0, instance.width, instance.height);

    drawRoom(instance, instance.scene);
    drawObjects(instance, instance.scene);
    drawParticles(instance, instance.scene);
    drawLabels(instance, instance.scene);
  }

  function frame(instance, timestamp) {
    if (!instance.lastFrame) {
      instance.lastFrame = timestamp;
    }
    const deltaSeconds = clamp((timestamp - instance.lastFrame) / 1000, 0, 0.05);
    instance.lastFrame = timestamp;
    instance.state.time += deltaSeconds;
    if (instance.state.targetYaw !== null && instance.state.targetPitch !== null && instance.state.targetZoom !== null) {
      if (instance.state.targetProjection) {
        instance.state.projection = instance.state.targetProjection;
      }
      instance.state.yaw = lerpAngle(instance.state.yaw, instance.state.targetYaw, 0.18);
      instance.state.pitch = lerp(instance.state.pitch, instance.state.targetPitch, 0.18);
      instance.state.zoom = lerp(instance.state.zoom, instance.state.targetZoom, 0.18);
      if (
        Math.abs(normalizeAngle(instance.state.targetYaw - instance.state.yaw)) < 0.01
        && Math.abs(instance.state.targetPitch - instance.state.pitch) < 0.01
        && Math.abs(instance.state.targetZoom - instance.state.zoom) < 0.01
      ) {
        instance.state.yaw = instance.state.targetYaw;
        instance.state.pitch = instance.state.targetPitch;
        instance.state.zoom = instance.state.targetZoom;
        instance.state.projection = instance.state.targetProjection || instance.state.projection;
      }
    }
    syncViewCube(instance);
    drawFrame(instance);
    instance.rafId = window.requestAnimationFrame(function (nextTime) {
      frame(instance, nextTime);
    });
  }

  function start(instance) {
    if (instance.rafId) {
      return;
    }
    instance.lastFrame = 0;
    instance.rafId = window.requestAnimationFrame(function (timestamp) {
      frame(instance, timestamp);
    });
  }

  function syncViewCube(instance) {
    if (!instance || !instance.viewCube) {
      return;
    }
    const rotationX = roundTo((-instance.state.pitch * 180 / Math.PI), 2);
    const rotationZ = roundTo((instance.state.yaw * 180 / Math.PI), 2);
    instance.viewCube.style.transform = "rotateX(" + rotationX + "deg) rotateZ(" + rotationZ + "deg)";
  }

  function render(canvas, result) {
    if (!canvas) {
      return;
    }
    const instance = ensureInstance(canvas);
    instance.scene = result ? buildScene(result) : null;
    drawFrame(instance);
    start(instance);
  }

  function capture(canvas) {
    return canvas ? canvas.toDataURL("image/png") : "";
  }

  window.Schematic3D = {
    render: render,
    capture: capture
  };
}());
