/*!
 * MotionPathPlugin 3.5.1
 * https://greensock.com
 *
 * @license Copyright 2020, GreenSock. All rights reserved.
 * Subject to the terms at https://greensock.com/standard-license or for Club GreenSock members, the agreement issued with that membership.
 * @author: Jack Doyle, jack@greensock.com
 */

!(function (t, e) {
    "object" == typeof exports && "undefined" != typeof module ? e(exports) : "function" == typeof define && define.amd ? define(["exports"], e) : e(((t = t || self).window = t.window || {}));
})(this, function (t) {
    "use strict";
    function p(t) {
        return "string" == typeof t;
    }
    function x(t, e, n, r) {
        var a = t[e],
            o = 1 === r ? 6 : subdivideSegment(a, n, r);
        if (o && o + n + 2 < a.length) return t.splice(e, 0, a.slice(0, n + o + 2)), a.splice(0, n + o), 1;
    }
    function A(t, e) {
        var n = t.length,
            r = t[n - 1] || [],
            a = r.length;
        e[0] === r[a - 2] && e[1] === r[a - 1] && ((e = r.concat(e.slice(2))), n--), (t[n] = e);
    }
    var M = /[achlmqstvz]|(-?\d*\.?\d*(?:e[\-+]?\d+)?)[0-9]/gi,
        R = /(?:(-)?\d*\.?\d*(?:e[\-+]?\d+)?)[0-9]/gi,
        L = /[\+\-]?\d*\.?\d+e[\+\-]?\d+/gi,
        r = /(^[#\.][a-z]|[a-y][a-z])/i,
        q = Math.PI / 180,
        s = 180 / Math.PI,
        F = Math.sin,
        H = Math.cos,
        Q = Math.abs,
        $ = Math.sqrt,
        S = Math.atan2,
        B = 1e8,
        l = function _isNumber(t) {
            return "number" == typeof t;
        },
        N = {},
        _ = {},
        e = 1e5,
        d = function _wrapProgress(t) {
            return Math.round(((t + B) % 1) * e) / e || (t < 0 ? 0 : 1);
        },
        C = function _round(t) {
            return Math.round(t * e) / e || 0;
        },
        I = function _copyMetaData(t, e) {
            return (e.totalLength = t.totalLength), t.samples ? ((e.samples = t.samples.slice(0)), (e.lookup = t.lookup.slice(0)), (e.minLength = t.minLength), (e.resolution = t.resolution)) : (e.totalPoints = t.totalPoints), e;
        };
    function getRawPath(t) {
        var e,
            n = (t = (p(t) && r.test(t) && document.querySelector(t)) || t).getAttribute ? t : 0;
        return n && (t = t.getAttribute("d"))
            ? (n._gsPath || (n._gsPath = {}), (e = n._gsPath[t]) && !e._dirty ? e : (n._gsPath[t] = stringToRawPath(t)))
            : t
            ? p(t)
                ? stringToRawPath(t)
                : l(t[0])
                ? [t]
                : t
            : console.warn("Expecting a <path> element or an SVG path data string");
    }
    function reverseSegment(t) {
        var e,
            n = 0;
        for (t.reverse(); n < t.length; n += 2) (e = t[n]), (t[n] = t[n + 1]), (t[n + 1] = e);
        t.reversed = !t.reversed;
    }
    var E = { rect: "rx,ry,x,y,width,height", circle: "r,cx,cy", ellipse: "rx,ry,cx,cy", line: "x1,x2,y1,y2" };
    function convertToPath(t, e) {
        var n,
            r,
            a,
            o,
            i,
            s,
            l,
            h,
            u,
            f,
            g,
            c,
            p,
            d,
            m,
            v,
            x,
            y,
            P,
            w,
            b,
            M,
            L = t.tagName.toLowerCase(),
            T = 0.552284749831;
        return "path" !== L && t.getBBox
            ? ((s = (function _createPath(t, e) {
                  var n,
                      r = document.createElementNS("http://www.w3.org/2000/svg", "path"),
                      a = [].slice.call(t.attributes),
                      o = a.length;
                  for (e = "," + e + ","; -1 < --o; ) (n = a[o].nodeName.toLowerCase()), e.indexOf("," + n + ",") < 0 && r.setAttributeNS(null, n, a[o].nodeValue);
                  return r;
              })(t, "x,y,width,height,cx,cy,rx,ry,r,x1,x2,y1,y2,points")),
              (M = (function _attrToObj(t, e) {
                  for (var n = e ? e.split(",") : [], r = {}, a = n.length; -1 < --a; ) r[n[a]] = +t.getAttribute(n[a]) || 0;
                  return r;
              })(t, E[L])),
              "rect" === L
                  ? ((o = M.rx),
                    (i = M.ry || o),
                    (r = M.x),
                    (a = M.y),
                    (f = M.width - 2 * o),
                    (g = M.height - 2 * i),
                    (n =
                        o || i
                            ? "M" +
                              (v = (d = (p = r + o) + f) + o) +
                              "," +
                              (y = a + i) +
                              " V" +
                              (P = y + g) +
                              " C" +
                              [
                                  v,
                                  (w = P + i * T),
                                  (m = d + o * T),
                                  (b = P + i),
                                  d,
                                  b,
                                  d - (d - p) / 3,
                                  b,
                                  p + (d - p) / 3,
                                  b,
                                  p,
                                  b,
                                  (c = r + o * (1 - T)),
                                  b,
                                  r,
                                  w,
                                  r,
                                  P,
                                  r,
                                  P - (P - y) / 3,
                                  r,
                                  y + (P - y) / 3,
                                  r,
                                  y,
                                  r,
                                  (x = a + i * (1 - T)),
                                  c,
                                  a,
                                  p,
                                  a,
                                  p + (d - p) / 3,
                                  a,
                                  d - (d - p) / 3,
                                  a,
                                  d,
                                  a,
                                  m,
                                  a,
                                  v,
                                  x,
                                  v,
                                  y,
                              ].join(",") +
                              "z"
                            : "M" + (r + f) + "," + a + " v" + g + " h" + -f + " v" + -g + " h" + f + "z"))
                  : "circle" === L || "ellipse" === L
                  ? ((h = "circle" === L ? (o = i = M.r) * T : ((o = M.rx), (i = M.ry) * T)),
                    (n =
                        "M" +
                        ((r = M.cx) + o) +
                        "," +
                        (a = M.cy) +
                        " C" +
                        [r + o, a + h, r + (l = o * T), a + i, r, a + i, r - l, a + i, r - o, a + h, r - o, a, r - o, a - h, r - l, a - i, r, a - i, r + l, a - i, r + o, a - h, r + o, a].join(",") +
                        "z"))
                  : "line" === L
                  ? (n = "M" + M.x1 + "," + M.y1 + " L" + M.x2 + "," + M.y2)
                  : ("polyline" !== L && "polygon" !== L) || ((n = "M" + (r = (u = (t.getAttribute("points") + "").match(R) || []).shift()) + "," + (a = u.shift()) + " L" + u.join(",")), "polygon" === L && (n += "," + r + "," + a + "z")),
              s.setAttribute("d", rawPathToString((s._gsRawPath = stringToRawPath(n)))),
              e && t.parentNode && (t.parentNode.insertBefore(s, t), t.parentNode.removeChild(t)),
              s)
            : t;
    }
    function getRotationAtBezierT(t, e, n) {
        var r,
            a = t[e],
            o = t[e + 2],
            i = t[e + 4];
        return (
            (a += (o - a) * n),
            (a += ((o += (i - o) * n) - a) * n),
            (r = o + (i + (t[e + 6] - i) * n - o) * n - a),
            (a = t[e + 1]),
            (a += ((o = t[e + 3]) - a) * n),
            (a += ((o += ((i = t[e + 5]) - o) * n) - a) * n),
            C(S(o + (i + (t[e + 7] - i) * n - o) * n - a, r) * s)
        );
    }
    function sliceRawPath(t, e, n) {
        !(function _isUndefined(t) {
            return void 0 === t;
        })(n) || (n = 1);
        var r = n < (e = e || 0),
            a = Math.max(0, ~~(Q(n - e) - 1e-8));
        if ((r && ((r = n), (n = e), (e = r), (r = 1), (a -= a ? 1 : 0)), e < 0 || n < 0)) {
            var o = 1 + ~~Math.min(e, n);
            (e += o), (n += o);
        }
        var i,
            s,
            l,
            h,
            u,
            f,
            g,
            c = (function copyRawPath(t) {
                for (var e = [], n = 0; n < t.length; n++) e[n] = I(t[n], t[n].slice(0));
                return I(t, e);
            })(t.totalLength ? t : cacheRawPathMeasurements(t)),
            p = 1 < n,
            d = getProgressData(c, e, N, !0),
            m = getProgressData(c, n, _),
            v = m.segment,
            y = d.segment,
            P = m.segIndex,
            w = d.segIndex,
            b = m.i,
            M = d.i,
            L = w === P,
            T = b === M && L,
            R = (L && b < M) || (T && d.t > m.t);
        if (p || a) {
            if (
                (x(c, w, M, d.t) && ((i = 1), w++, T ? (R ? (m.t /= d.t) : ((m.t = (m.t - d.t) / (1 - d.t)), P++, (b = 0))) : w <= P + 1 && !R && (P++, L && (b -= M))),
                m.t ? x(c, P, b, m.t) && (R && i && w++, r && P++) : (P--, r && w--),
                (h = []),
                (f = 1 + (u = c.length) * a),
                (g = w),
                r)
            )
                for (f += (u - (P = (P || u) - 1) + w) % u, l = 0; l < f; l++) A(h, c[g]), (g = (g || u) - 1);
            else for (f += (u - w + P) % u, l = 0; l < f; l++) A(h, c[g++ % u]);
            c = h;
        } else if (((s = 1 === m.t ? 6 : subdivideSegment(v, b, m.t)), e !== n))
            for (i = subdivideSegment(y, M, T ? d.t / m.t : d.t), L && (s += i), v.splice(b + s + 2), (i || M) && y.splice(0, M + i), l = c.length; l--; ) (l < w || P < l) && c.splice(l, 1);
        else (v.angle = getRotationAtBezierT(v, b + s, 0)), (d = v[(b += s)]), (m = v[b + 1]), (v.length = v.totalLength = 0), (v.totalPoints = c.totalPoints = 8), v.push(d, m, d, m, d, m, d, m);
        return (
            r &&
                (function _reverseRawPath(t, e) {
                    var n = t.length;
                    for (e || t.reverse(); n--; ) t[n].reversed || reverseSegment(t[n]);
                })(c, p || a),
            (c.totalLength = 0),
            c
        );
    }
    function measureSegment(t, e, n) {
        (e = e || 0), t.samples || ((t.samples = []), (t.lookup = []));
        var r,
            a,
            o,
            i,
            s,
            l,
            h,
            u,
            f,
            g,
            c,
            p,
            d,
            m,
            v,
            x,
            y,
            P = ~~t.resolution || 12,
            w = 1 / P,
            b = n ? e + 6 * n + 1 : t.length,
            M = t[e],
            L = t[e + 1],
            T = e ? (e / 6) * P : 0,
            R = t.samples,
            S = t.lookup,
            N = (e ? t.minLength : B) || B,
            _ = R[T + n * P - 1],
            C = e ? R[T - 1] : 0;
        for (R.length = S.length = 0, a = e + 2; a < b; a += 6) {
            if (((o = t[a + 4] - M), (i = t[a + 2] - M), (s = t[a] - M), (u = t[a + 5] - L), (f = t[a + 3] - L), (g = t[a + 1] - L), (l = h = c = p = 0), Q(o) < 1e-5 && Q(u) < 1e-5 && Q(s) + Q(g) < 1e-5))
                8 < t.length && (t.splice(a, 6), (a -= 6), (b -= 6));
            else
                for (r = 1; r <= P; r++)
                    (l = h - (h = ((m = w * r) * m * o + 3 * (d = 1 - m) * (m * i + d * s)) * m)), (c = p - (p = (m * m * u + 3 * d * (m * f + d * g)) * m)), (x = $(c * c + l * l)) < N && (N = x), (C += x), (R[T++] = C);
            (M += o), (L += u);
        }
        if (_) for (_ -= C; T < R.length; T++) R[T] += _;
        if (R.length && N) for (t.totalLength = y = R[R.length - 1] || 0, t.minLength = N, x = v = 0, r = 0; r < y; r += N) S[x++] = R[v] < r ? ++v : v;
        else t.totalLength = R[0] = 0;
        return e ? C - R[e / 2 - 1] : C;
    }
    function cacheRawPathMeasurements(t, e) {
        var n, r, a;
        for (a = n = r = 0; a < t.length; a++) (t[a].resolution = ~~e || 12), (r += t[a].length), (n += measureSegment(t[a]));
        return (t.totalPoints = r), (t.totalLength = n), t;
    }
    function subdivideSegment(t, e, n) {
        if (n <= 0 || 1 <= n) return 0;
        var r = t[e],
            a = t[e + 1],
            o = t[e + 2],
            i = t[e + 3],
            s = t[e + 4],
            l = t[e + 5],
            h = r + (o - r) * n,
            u = o + (s - o) * n,
            f = a + (i - a) * n,
            g = i + (l - i) * n,
            c = h + (u - h) * n,
            p = f + (g - f) * n,
            d = s + (t[e + 6] - s) * n,
            m = l + (t[e + 7] - l) * n;
        return (
            (u += (d - u) * n),
            (g += (m - g) * n),
            t.splice(e + 2, 4, C(h), C(f), C(c), C(p), C(c + (u - c) * n), C(p + (g - p) * n), C(u), C(g), C(d), C(m)),
            t.samples && t.samples.splice(((e / 6) * t.resolution) | 0, 0, 0, 0, 0, 0, 0, 0),
            6
        );
    }
    function getProgressData(t, e, n, r) {
        (n = n || {}), t.totalLength || cacheRawPathMeasurements(t), (e < 0 || 1 < e) && (e = d(e));
        var a,
            o,
            i,
            s,
            l,
            h,
            u,
            f = 0,
            g = t[0];
        if (1 < t.length) {
            for (i = t.totalLength * e, l = h = 0; (l += t[h++].totalLength) < i; ) f = h;
            e = (i - (s = l - (g = t[f]).totalLength)) / (l - s) || 0;
        }
        return (
            (a = g.samples),
            (o = g.resolution),
            (i = g.totalLength * e),
            (s = (h = g.lookup[~~(i / g.minLength)] || 0) ? a[h - 1] : 0),
            (l = a[h]) < i && ((s = l), (l = a[++h])),
            (u = (1 / o) * ((i - s) / (l - s) + (h % o))),
            (h = 6 * ~~(h / o)),
            r && 1 === u && (h + 6 < g.length ? ((h += 6), (u = 0)) : f + 1 < t.length && ((h = u = 0), (g = t[++f]))),
            (n.t = u),
            (n.i = h),
            (n.path = t),
            (n.segment = g),
            (n.segIndex = f),
            n
        );
    }
    function getPositionOnPath(t, e, n, r) {
        var a,
            o,
            i,
            s,
            l,
            h,
            u,
            f,
            g,
            c = t[0],
            p = r || {};
        if (((e < 0 || 1 < e) && (e = d(e)), 1 < t.length)) {
            for (i = t.totalLength * e, l = h = 0; (l += t[h++].totalLength) < i; ) c = t[h];
            e = (i - (s = l - c.totalLength)) / (l - s) || 0;
        }
        return (
            (a = c.samples),
            (o = c.resolution),
            (i = c.totalLength * e),
            (s = (h = c.lookup[~~(i / c.minLength)] || 0) ? a[h - 1] : 0),
            (l = a[h]) < i && ((s = l), (l = a[++h])),
            (g = 1 - (u = (1 / o) * ((i - s) / (l - s) + (h % o)) || 0)),
            (f = c[(h = 6 * ~~(h / o))]),
            (p.x = C((u * u * (c[h + 6] - f) + 3 * g * (u * (c[h + 4] - f) + g * (c[h + 2] - f))) * u + f)),
            (p.y = C((u * u * (c[h + 7] - (f = c[h + 1])) + 3 * g * (u * (c[h + 5] - f) + g * (c[h + 3] - f))) * u + f)),
            n && (p.angle = c.totalLength ? getRotationAtBezierT(c, h, 1 <= u ? 1 - 1e-9 : u || 1e-9) : c.angle || 0),
            p
        );
    }
    function transformRawPath(t, e, n, r, a, o, i) {
        for (var s, l, h, u, f, g = t.length; -1 < --g; ) for (l = (s = t[g]).length, h = 0; h < l; h += 2) (u = s[h]), (f = s[h + 1]), (s[h] = u * e + f * r + o), (s[h + 1] = u * n + f * a + i);
        return (t._dirty = 1), t;
    }
    function arcToSegment(t, e, n, r, a, o, i, s, l) {
        if (t !== s || e !== l) {
            (n = Q(n)), (r = Q(r));
            var h = (a % 360) * q,
                u = H(h),
                f = F(h),
                g = Math.PI,
                c = 2 * g,
                p = (t - s) / 2,
                d = (e - l) / 2,
                m = u * p + f * d,
                v = -f * p + u * d,
                x = m * m,
                y = v * v,
                P = x / (n * n) + y / (r * r);
            1 < P && ((n = $(P) * n), (r = $(P) * r));
            var w = n * n,
                b = r * r,
                M = (w * b - w * y - b * x) / (w * y + b * x);
            M < 0 && (M = 0);
            var L = (o === i ? -1 : 1) * $(M),
                T = ((n * v) / r) * L,
                R = ((-r * m) / n) * L,
                S = u * T - f * R + (t + s) / 2,
                N = f * T + u * R + (e + l) / 2,
                _ = (m - T) / n,
                C = (v - R) / r,
                A = (-m - T) / n,
                O = (-v - R) / r,
                B = _ * _ + C * C,
                I = (C < 0 ? -1 : 1) * Math.acos(_ / $(B)),
                E = (_ * O - C * A < 0 ? -1 : 1) * Math.acos((_ * A + C * O) / $(B * (A * A + O * O)));
            isNaN(E) && (E = g), !i && 0 < E ? (E -= c) : i && E < 0 && (E += c), (I %= c), (E %= c);
            var G,
                D = Math.ceil(Q(E) / (c / 4)),
                z = [],
                W = E / D,
                Y = ((4 / 3) * F(W / 2)) / (1 + H(W / 2)),
                j = u * n,
                k = f * n,
                V = f * -r,
                X = u * r;
            for (G = 0; G < D; G++) (m = H((a = I + G * W))), (v = F(a)), (_ = H((a += W))), (C = F(a)), z.push(m - Y * v, v + Y * m, _ + Y * C, C - Y * _, _, C);
            for (G = 0; G < z.length; G += 2) (m = z[G]), (v = z[G + 1]), (z[G] = m * j + v * V + S), (z[G + 1] = m * k + v * X + N);
            return (z[G - 2] = s), (z[G - 1] = l), z;
        }
    }
    function stringToRawPath(t) {
        function rf(t, e, n, r) {
            (u = (n - t) / 3), (f = (r - e) / 3), s.push(t + u, e + f, n - u, r - f, n, r);
        }
        var e,
            n,
            r,
            a,
            o,
            i,
            s,
            l,
            h,
            u,
            f,
            g,
            c,
            p,
            d,
            m =
                (t + "")
                    .replace(L, function (t) {
                        var e = +t;
                        return e < 1e-4 && -1e-4 < e ? 0 : e;
                    })
                    .match(M) || [],
            v = [],
            x = 0,
            y = 0,
            P = m.length,
            w = 0,
            b = "ERROR: malformed path: " + t;
        if (!t || !isNaN(m[0]) || isNaN(m[1])) return console.log(b), v;
        for (e = 0; e < P; e++)
            if (((c = o), isNaN(m[e]) ? (i = (o = m[e].toUpperCase()) !== m[e]) : e--, (r = +m[e + 1]), (a = +m[e + 2]), i && ((r += x), (a += y)), e || ((l = r), (h = a)), "M" === o))
                s && (s.length < 8 ? --v.length : (w += s.length)), (x = l = r), (y = h = a), (s = [r, a]), v.push(s), (e += 2), (o = "L");
            else if ("C" === o) i || (x = y = 0), (s = s || [0, 0]).push(r, a, x + 1 * m[e + 3], y + 1 * m[e + 4], (x += 1 * m[e + 5]), (y += 1 * m[e + 6])), (e += 6);
            else if ("S" === o) (u = x), (f = y), ("C" !== c && "S" !== c) || ((u += x - s[s.length - 4]), (f += y - s[s.length - 3])), i || (x = y = 0), s.push(u, f, r, a, (x += 1 * m[e + 3]), (y += 1 * m[e + 4])), (e += 4);
            else if ("Q" === o) (u = x + (2 / 3) * (r - x)), (f = y + (2 / 3) * (a - y)), i || (x = y = 0), (x += 1 * m[e + 3]), (y += 1 * m[e + 4]), s.push(u, f, x + (2 / 3) * (r - x), y + (2 / 3) * (a - y), x, y), (e += 4);
            else if ("T" === o) (u = x - s[s.length - 4]), (f = y - s[s.length - 3]), s.push(x + u, y + f, r + (2 / 3) * (x + 1.5 * u - r), a + (2 / 3) * (y + 1.5 * f - a), (x = r), (y = a)), (e += 2);
            else if ("H" === o) rf(x, y, (x = r), y), (e += 1);
            else if ("V" === o) rf(x, y, x, (y = r + (i ? y - x : 0))), (e += 1);
            else if ("L" === o || "Z" === o) "Z" === o && ((r = l), (a = h), (s.closed = !0)), ("L" === o || 0.5 < Q(x - r) || 0.5 < Q(y - a)) && (rf(x, y, r, a), "L" === o && (e += 2)), (x = r), (y = a);
            else if ("A" === o) {
                if (
                    ((p = m[e + 4]),
                    (d = m[e + 5]),
                    (u = m[e + 6]),
                    (f = m[e + 7]),
                    (n = 7),
                    1 < p.length && (p.length < 3 ? ((f = u), (u = d), n--) : ((f = d), (u = p.substr(2)), (n -= 2)), (d = p.charAt(1)), (p = p.charAt(0))),
                    (g = arcToSegment(x, y, +m[e + 1], +m[e + 2], +m[e + 3], +p, +d, (i ? x : 0) + 1 * u, (i ? y : 0) + 1 * f)),
                    (e += n),
                    g)
                )
                    for (n = 0; n < g.length; n++) s.push(g[n]);
                (x = s[s.length - 2]), (y = s[s.length - 1]);
            } else console.log(b);
        return (e = s.length) < 6 ? (v.pop(), (e = 0)) : s[0] === s[e - 2] && s[1] === s[e - 1] && (s.closed = !0), (v.totalPoints = w + e), v;
    }
    function flatPointsToSegment(t, e) {
        void 0 === e && (e = 1);
        for (var n = t[0], r = 0, a = [n, r], o = 2; o < t.length; o += 2) a.push(n, r, t[o], (r = ((t[o] - n) * e) / 2), (n = t[o]), -r);
        return a;
    }
    function pointsToSegment(t, e, n) {
        var r,
            a,
            o,
            i,
            s,
            l,
            h,
            u,
            f,
            g,
            c,
            p,
            d,
            m,
            v = t.length - 2,
            x = +t[0],
            y = +t[1],
            P = +t[2],
            w = +t[3],
            b = [x, y, x, y],
            M = P - x,
            L = w - y,
            T = Math.abs(t[v] - x) < 0.001 && Math.abs(t[v + 1] - y) < 0.001;
        for (isNaN(n) && (n = Math.PI / 10), T && (t.push(P, w), (P = x), (w = y), (x = t[v - 2]), (y = t[v - 1]), t.unshift(x, y), (v += 4)), e = e || 0 === e ? +e : 1, s = 2; s < v; s += 2)
            (r = x),
                (a = y),
                (x = P),
                (y = w),
                (p = (l = M) * l + (u = L) * u),
                (d = (M = (P = +t[s + 2]) - x) * M + (L = (w = +t[s + 3]) - y) * L),
                (m = (h = P - r) * h + (f = w - a) * f),
                (c = ((o = Math.acos((p + d - m) / $(4 * p * d))) / Math.PI) * e),
                (g = $(p) * c),
                (c *= $(d)),
                (x === r && y === a) ||
                    (n < o
                        ? ((i = S(f, h)), b.push(C(x - H(i) * g), C(y - F(i) * g), C(x), C(y), C(x + H(i) * c), C(y + F(i) * c)))
                        : ((i = S(u, l)), b.push(C(x - H(i) * g), C(y - F(i) * g)), (i = S(L, M)), b.push(C(x), C(y), C(x + H(i) * c), C(y + F(i) * c))));
        return b.push(C(P), C(w), C(P), C(w)), T && (b.splice(0, 6), (b.length = b.length - 6)), b;
    }
    function rawPathToString(t) {
        l(t[0]) && (t = [t]);
        var e,
            n,
            r,
            a,
            o = "",
            i = t.length;
        for (n = 0; n < i; n++) {
            for (a = t[n], o += "M" + C(a[0]) + "," + C(a[1]) + " C", e = a.length, r = 2; r < e; r++) o += C(a[r++]) + "," + C(a[r++]) + " " + C(a[r++]) + "," + C(a[r++]) + " " + C(a[r++]) + "," + C(a[r]) + " ";
            a.closed && (o += "z");
        }
        return o;
    }
    function O(t) {
        var e = t.ownerDocument || t;
        !(w in t.style) && "msTransform" in t.style && (b = (w = "msTransform") + "Origin");
        for (; e.parentNode && (e = e.parentNode); );
        if (((c = window), (y = new D()), e)) {
            (m = (g = e).documentElement), (v = e.body);
            var n = e.createElement("div"),
                r = e.createElement("div");
            v.appendChild(n), n.appendChild(r), (n.style.position = "static"), (n.style[w] = "translate3d(0,0,1px)"), (P = r.offsetParent !== n), v.removeChild(n);
        }
        return e;
    }
    function U(t) {
        return t.ownerSVGElement || ("svg" === (t.tagName + "").toLowerCase() ? t : null);
    }
    function W(t, e) {
        if (t.parentNode && (g || O(t))) {
            var n = U(t),
                r = n ? n.getAttribute("xmlns") || "http://www.w3.org/2000/svg" : "http://www.w3.org/1999/xhtml",
                a = n ? (e ? "rect" : "g") : "div",
                o = 2 !== e ? 0 : 100,
                i = 3 === e ? 100 : 0,
                s = "position:absolute;display:block;pointer-events:none;",
                l = g.createElementNS ? g.createElementNS(r.replace(/^https/, "http"), a) : g.createElement(a);
            return (
                e &&
                    (n
                        ? ((f = f || W(t)), l.setAttribute("width", 0.01), l.setAttribute("height", 0.01), l.setAttribute("transform", "translate(" + o + "," + i + ")"), f.appendChild(l))
                        : (u || ((u = W(t)).style.cssText = s), (l.style.cssText = s + "width:0.1px;height:0.1px;top:" + i + "px;left:" + o + "px"), u.appendChild(l))),
                l
            );
        }
        throw "Need document and parent.";
    }
    function Y(t, e) {
        var n,
            r,
            a,
            o,
            i,
            s = U(t),
            l = t === s,
            h = s ? T : G;
        if (t === c) return t;
        if ((h.length || h.push(W(t, 1), W(t, 2), W(t, 3)), (n = s ? f : u), s))
            (a = l ? { x: 0, y: 0 } : t.getBBox()),
                (i = (r = t.transform ? t.transform.baseVal : {}).numberOfItems
                    ? ((o =
                          (r =
                              1 < r.numberOfItems
                                  ? (function _consolidate(t) {
                                        for (var e = new D(), n = 0; n < t.numberOfItems; n++) e.multiply(t.getItem(n).matrix);
                                        return e;
                                    })(r)
                                  : r.getItem(0).matrix).a *
                              a.x +
                          r.c * a.y),
                      r.b * a.x + r.d * a.y)
                    : ((r = y), (o = a.x), a.y)),
                e && "g" === t.tagName.toLowerCase() && (o = i = 0),
                n.setAttribute("transform", "matrix(" + r.a + "," + r.b + "," + r.c + "," + r.d + "," + (r.e + o) + "," + (r.f + i) + ")"),
                (l ? s : t.parentNode).appendChild(n);
        else {
            if (((o = i = 0), P)) for (r = t.offsetParent, a = t; (a = a && a.parentNode) && a !== r && a.parentNode; ) 4 < (c.getComputedStyle(a)[w] + "").length && ((o = a.offsetLeft), (i = a.offsetTop), (a = 0));
            ((a = n.style).top = t.offsetTop - i + "px"),
                (a.left = t.offsetLeft - o + "px"),
                (r = c.getComputedStyle(t)),
                (a[w] = r[w]),
                (a[b] = r[b]),
                (a.border = r.border),
                (a.borderLeftStyle = r.borderLeftStyle),
                (a.borderTopStyle = r.borderTopStyle),
                (a.borderLeftWidth = r.borderLeftWidth),
                (a.borderTopWidth = r.borderTopWidth),
                (a.position = "fixed" === r.position ? "fixed" : "absolute"),
                t.parentNode.appendChild(n);
        }
        return n;
    }
    function Z(t, e, n, r, a, o, i) {
        return (t.a = e), (t.b = n), (t.c = r), (t.d = a), (t.e = o), (t.f = i), t;
    }
    var g,
        c,
        m,
        v,
        u,
        f,
        y,
        P,
        n,
        w = "transform",
        b = w + "Origin",
        T = [],
        G = [],
        D =
            (((n = Matrix2D.prototype).inverse = function inverse() {
                var t = this.a,
                    e = this.b,
                    n = this.c,
                    r = this.d,
                    a = this.e,
                    o = this.f,
                    i = t * r - e * n || 1e-10;
                return Z(this, r / i, -e / i, -n / i, t / i, (n * o - r * a) / i, -(t * o - e * a) / i);
            }),
            (n.multiply = function multiply(t) {
                var e = this.a,
                    n = this.b,
                    r = this.c,
                    a = this.d,
                    o = this.e,
                    i = this.f,
                    s = t.a,
                    l = t.c,
                    h = t.b,
                    u = t.d,
                    f = t.e,
                    g = t.f;
                return Z(this, s * e + h * r, s * n + h * a, l * e + u * r, l * n + u * a, o + f * e + g * r, i + f * n + g * a);
            }),
            (n.clone = function clone() {
                return new Matrix2D(this.a, this.b, this.c, this.d, this.e, this.f);
            }),
            (n.equals = function equals(t) {
                var e = this.a,
                    n = this.b,
                    r = this.c,
                    a = this.d,
                    o = this.e,
                    i = this.f;
                return e === t.a && n === t.b && r === t.c && a === t.d && o === t.e && i === t.f;
            }),
            (n.apply = function apply(t, e) {
                void 0 === e && (e = {});
                var n = t.x,
                    r = t.y,
                    a = this.a,
                    o = this.b,
                    i = this.c,
                    s = this.d,
                    l = this.e,
                    h = this.f;
                return (e.x = n * a + r * i + l || 0), (e.y = n * o + r * s + h || 0), e;
            }),
            Matrix2D);
    function Matrix2D(t, e, n, r, a, o) {
        void 0 === t && (t = 1), void 0 === e && (e = 0), void 0 === n && (n = 0), void 0 === r && (r = 1), void 0 === a && (a = 0), void 0 === o && (o = 0), Z(this, t, e, n, r, a, o);
    }
    function getGlobalMatrix(t, e, n) {
        if (!t || !t.parentNode || (g || O(t)).documentElement === t) return new D();
        var r = (function _forceNonZeroScale(t) {
                for (var e, n; t && t !== v; ) (n = t._gsap) && !n.scaleX && !n.scaleY && n.renderTransform && ((n.scaleX = n.scaleY = 1e-4), n.renderTransform(1, n), e ? e.push(n) : (e = [n])), (t = t.parentNode);
                return e;
            })(t.parentNode),
            a = U(t) ? T : G,
            o = Y(t, n),
            i = a[0].getBoundingClientRect(),
            s = a[1].getBoundingClientRect(),
            l = a[2].getBoundingClientRect(),
            h = o.parentNode,
            u = (function _isFixed(t) {
                return "fixed" === c.getComputedStyle(t).position || ((t = t.parentNode) && 1 === t.nodeType ? _isFixed(t) : void 0);
            })(t),
            f = new D(
                (s.left - i.left) / 100,
                (s.top - i.top) / 100,
                (l.left - i.left) / 100,
                (l.top - i.top) / 100,
                i.left +
                    (u
                        ? 0
                        : (function _getDocScrollLeft() {
                              return c.pageXOffset || g.scrollLeft || m.scrollLeft || v.scrollLeft || 0;
                          })()),
                i.top +
                    (u
                        ? 0
                        : (function _getDocScrollTop() {
                              return c.pageYOffset || g.scrollTop || m.scrollTop || v.scrollTop || 0;
                          })())
            );
        if ((h.removeChild(o), r)) for (i = r.length; i--; ) ((s = r[i]).scaleX = s.scaleY = 0), s.renderTransform(1, s);
        return e ? f.inverse() : f;
    }
    function ha(t, e, n, r) {
        for (var a = e.length, o = 2 === r ? 0 : r, i = 0; i < a; i++) (t[o] = parseFloat(e[i][n])), 2 === r && (t[o + 1] = 0), (o += 2);
        return t;
    }
    function ia(t, e, n) {
        return parseFloat(t._gsap.get(t, e, n || "px")) || 0;
    }
    function ja(t) {
        var e,
            n = t[0],
            r = t[1];
        for (e = 2; e < t.length; e += 2) (n = t[e] += n), (r = t[e + 1] += r);
    }
    function ka(t, e, n, r, a, o, i) {
        return (
            (e = "cubic" === i.type ? [e] : (e.unshift(ia(n, r, i.unitX), a ? ia(n, a, i.unitY) : 0), i.relative && ja(e), [(a ? pointsToSegment : flatPointsToSegment)(e, i.curviness)])),
            (e = o(tt(e, n, i))),
            et(t, n, r, e, "x", i.unitX),
            a && et(t, n, a, e, "y", i.unitY),
            cacheRawPathMeasurements(e, i.resolution || (0 === i.curviness ? 20 : 12))
        );
    }
    function la(t) {
        return t;
    }
    function na(t, e, n) {
        var r,
            a,
            o,
            i = getGlobalMatrix(t);
        return (
            "svg" === (t.tagName + "").toLowerCase()
                ? ((a = (r = t.viewBox.baseVal).x), (o = r.y), r.width || (r = { width: +t.getAttribute("width"), height: +t.getAttribute("height") }))
                : ((r = e && t.getBBox && t.getBBox()), (a = o = 0)),
            e && "auto" !== e && ((a += e.push ? e[0] * (r ? r.width : t.offsetWidth || 0) : e.x), (o += e.push ? e[1] * (r ? r.height : t.offsetHeight || 0) : e.y)),
            n.apply(a || o ? i.apply({ x: a, y: o }) : { x: i.e, y: i.f })
        );
    }
    function oa(t, e, n, r) {
        var a,
            o = getGlobalMatrix(t.parentNode, !0, !0),
            i = o.clone().multiply(getGlobalMatrix(e)),
            s = na(t, n, o),
            l = na(e, r, o),
            h = l.x,
            u = l.y;
        return (
            (i.e = i.f = 0),
            "auto" === r && e.getTotalLength && "path" === e.tagName.toLowerCase() && ((a = e.getAttribute("d").match(K) || []), (h += (a = i.apply({ x: +a[0], y: +a[1] })).x), (u += a.y)),
            (a || (e.getBBox && t.getBBox && e.ownerSVGElement === t.ownerSVGElement)) && ((h -= (a = i.apply(e.getBBox())).x), (u -= a.y)),
            (i.e = h - s.x),
            (i.f = u - s.y),
            i
        );
    }
    var z,
        j,
        k,
        V,
        X = ["x", "translateX", "left", "marginLeft"],
        J = ["y", "translateY", "top", "marginTop"],
        o = Math.PI / 180,
        K = /[-+\.]*\d+[\.e\-\+]*\d*[e\-\+]*\d*/g,
        tt = function _align(t, e, n) {
            var r,
                a,
                o,
                i = n.align,
                s = n.matrix,
                l = n.offsetX,
                h = n.offsetY,
                u = n.alignOrigin,
                f = t[0][0],
                g = t[0][1],
                c = ia(e, "x"),
                p = ia(e, "y");
            return t && t.length
                ? (i &&
                      ("self" === i || (r = V(i)[0] || e) === e
                          ? transformRawPath(t, 1, 0, 0, 1, c - f, p - g)
                          : (u && !1 !== u[2] ? z.set(e, { transformOrigin: 100 * u[0] + "% " + 100 * u[1] + "%" }) : (u = [ia(e, "xPercent") / -100, ia(e, "yPercent") / -100]),
                            (o = (a = oa(e, r, u, "auto")).apply({ x: f, y: g })),
                            transformRawPath(t, a.a, a.b, a.c, a.d, c + a.e - (o.x - a.e), p + a.f - (o.y - a.f)))),
                  s ? transformRawPath(t, s.a, s.b, s.c, s.d, s.e, s.f) : (l || h) && transformRawPath(t, 1, 0, 0, 1, l || 0, h || 0),
                  t)
                : getRawPath("M0,0L0,0");
        },
        et = function _addDimensionalPropTween(t, e, n, r, a, o) {
            var i = e._gsap,
                s = i.harness,
                l = s && s.aliases && s.aliases[n],
                h = l && l.indexOf(",") < 0 ? l : n,
                u = (t._pt = new j(t._pt, e, h, 0, 0, la, 0, i.set(e, h, t)));
            (u.u = k(i.get(e, h, o)) || 0), (u.path = r), (u.pp = a), t._props.push(h);
        },
        a = {
            version: "3.5.1",
            name: "motionPath",
            register: function register(t, e, n) {
                (k = (z = t).utils.getUnit), (V = z.utils.toArray), (j = n);
            },
            init: function init(t, e) {
                if (!z) return console.warn("Please gsap.registerPlugin(MotionPathPlugin)"), !1;
                ("object" == typeof e && !e.style && e.path) || (e = { path: e });
                var n,
                    r,
                    a,
                    o,
                    i = [],
                    s = e.path,
                    l = s[0],
                    h = e.autoRotate,
                    u = (function _sliceModifier(e, n) {
                        return function (t) {
                            return e || 1 !== n ? sliceRawPath(t, e, n) : t;
                        };
                    })(e.start, "end" in e ? e.end : 1);
                if (
                    ((this.rawPaths = i),
                    (this.target = t),
                    (this.rotate = h || 0 === h) &&
                        ((this.rOffset = parseFloat(h) || 0), (this.radians = !!e.useRadians), (this.rProp = e.rotation || "rotation"), (this.rSet = t._gsap.set(t, this.rProp, this)), (this.ru = k(t._gsap.get(t, this.rProp)) || 0)),
                    !Array.isArray(s) || "closed" in s || "number" == typeof l)
                )
                    cacheRawPathMeasurements((n = u(tt(getRawPath(e.path), t, e))), e.resolution), i.push(n), et(this, t, e.x || "x", n, "x", e.unitX || "px"), et(this, t, e.y || "y", n, "y", e.unitY || "px");
                else {
                    for (r in l) ~X.indexOf(r) ? (a = r) : ~J.indexOf(r) && (o = r);
                    for (r in (a && o ? i.push(ka(this, ha(ha([], s, a, 0), s, o, 1), t, e.x || a, e.y || o, u, e)) : (a = o = 0), l)) r !== a && r !== o && i.push(ka(this, ha([], s, r, 2), t, r, 0, u, e));
                }
            },
            render: function render(t, e) {
                var n = e.rawPaths,
                    r = n.length,
                    a = e._pt;
                for (1 < t ? (t = 1) : t < 0 && (t = 0); r--; ) getPositionOnPath(n[r], t, !r && e.rotate, n[r]);
                for (; a; ) a.set(a.t, a.p, a.path[a.pp] + a.u, a.d, t), (a = a._next);
                e.rotate && e.rSet(e.target, e.rProp, n[0].angle * (e.radians ? o : 1) + e.rOffset + e.ru, e, t);
            },
            getLength: function getLength(t) {
                return cacheRawPathMeasurements(getRawPath(t)).totalLength;
            },
            sliceRawPath: sliceRawPath,
            getRawPath: getRawPath,
            pointsToSegment: pointsToSegment,
            stringToRawPath: stringToRawPath,
            rawPathToString: rawPathToString,
            transformRawPath: transformRawPath,
            getGlobalMatrix: getGlobalMatrix,
            getPositionOnPath: getPositionOnPath,
            cacheRawPathMeasurements: cacheRawPathMeasurements,
            convertToPath: function convertToPath$1(t, e) {
                return V(t).map(function (t) {
                    return convertToPath(t, !1 !== e);
                });
            },
            convertCoordinates: function convertCoordinates(t, e, n) {
                var r = getGlobalMatrix(e, !0, !0).multiply(getGlobalMatrix(t));
                return n ? r.apply(n) : r;
            },
            getAlignMatrix: oa,
            getRelativePosition: function getRelativePosition(t, e, n, r) {
                var a = oa(t, e, n, r);
                return { x: a.e, y: a.f };
            },
            arrayToRawPath: function arrayToRawPath(t, e) {
                var n = ha(ha([], t, (e = e || {}).x || "x", 0), t, e.y || "y", 1);
                return e.relative && ja(n), ["cubic" === e.type ? n : pointsToSegment(n, e.curviness)];
            },
        };
    !(function _getGSAP() {
        return z || ("undefined" != typeof window && (z = window.gsap) && z.registerPlugin && z);
    })() || z.registerPlugin(a),
        (t.MotionPathPlugin = a),
        (t.default = a);
    if (typeof window === "undefined" || window !== t) {
        Object.defineProperty(t, "__esModule", { value: !0 });
    } else {
        delete t.default;
    }
});
