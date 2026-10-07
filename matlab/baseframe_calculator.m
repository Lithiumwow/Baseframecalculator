%% Baseframe / Beam Load Calculator (MATLAB) — script version
% For the editable GUI app instead, run:  baseframe_app
%
% Mirrors the web app engineering model:
%   - Simply-supported beam: point / uniform / distributed loads
%   - Base frame: 4-corner area-method reactions + COG
%   - Multi-span longitudinal beam (independent simply-supported bays)
%   - Stress + governing safety factor (bending & shear)
%
% Run this file in MATLAB (R2019b+ recommended). Edit INPUTS below, then press Run.
%
% Units: mm for geometry inputs, N / N·m / MPa for results (same as the app).

clear; clc; close all;

%% ========================= INPUTS (edit me) =========================
analysisType = "Base Frame";   % "Simple Beam" or "Base Frame"

% --- Simple Beam ---
beam.length_mm   = 2000;
beam.left_mm     = 0;
beam.right_mm    = 2000;

% --- Base Frame ---
frame.length_mm  = 1980;
frame.width_mm   = 1082;

% Sections along length [start_mm, end_mm, casing_kg, baseframe_kg]
% Leave empty [] to skip section weights
sections = [
    0,    800,  50,  40;
    800, 1200,  40,  30;
   1200, 1980,  55,  45
];
leg_positions_mm = [0, 800, 1200, 1980];   % include ends

% Loads: struct array
% type: "Point" | "Uniform" | "Distributed"
% For Point:      magnitude (N or kg/lbs via unit), start_mm
% For Uniform:    magnitude = N/m, start_mm, end_mm
% For Distributed: magnitude total weight if unit kg/lbs; if unit "N" treated as N/m^2 * footprint
loads = struct( ...
    "type",        {"Distributed", "Point"}, ...
    "magnitude",   {150, 200}, ...
    "unit",        {"kg", "kg"}, ...
    "start_mm",    {200, 1000}, ...
    "end_mm",      {nan, nan}, ...
    "length_mm",   {400, nan}, ...
    "width_mm",    {frame.width_mm, nan}, ...
    "name",        {"Component A", "Fan"} ...
);

% Material / section (C-channel defaults similar to app)
mat.Fy_MPa = 250;          % A36
mat.E_GPa  = 200;
sec.kind   = "C Channel";  % "Rectangular" | "I Beam" | "C Channel" | "Circular"
sec.h_mm   = 218;
sec.bf_mm  = 66;
sec.tf_mm  = 3;
sec.tw_mm  = 44.8;
sec.b_mm   = 100;          % rectangular width
sec.d_mm   = 100;          % circular diameter

other_components_kg = 0;
total_roof_kg = 0;

%% ========================= PREP =========================
E = mat.E_GPa * 1e9;
props = section_properties(sec);
fprintf("Section: %s  A=%.4e m^2  I=%.4e m^4  S=%.4e m^3\n", ...
    sec.kind, props.A, props.I, props.S);

%% ========================= RUN =========================
if analysisType == "Simple Beam"
    [diag, R] = analyze_simple_beam(beam, loads, E, props.I);
    corner = [];
    cog = [];
    fprintf("\n=== Simple Beam ===\n");
    fprintf("R_left  = %.2f N\nR_right = %.2f N\n", R.left, R.right);
else
    [corner, cog, totalN] = analyze_base_frame_corners(frame, sections, loads, ...
        total_roof_kg, other_components_kg);
    [diag, ~] = analyze_multispan_frame(frame, sections, loads, leg_positions_mm, ...
        total_roof_kg, other_components_kg, E, props.I);
    fprintf("\n=== Base Frame Corner Reactions ===\n");
    fprintf("R1=%.1f  R2=%.1f  R3=%.1f  R4=%.1f  N\n", ...
        corner.R1, corner.R2, corner.R3, corner.R4);
    fprintf("Sum R = %.1f N | Total load = %.1f N\n", ...
        corner.R1+corner.R2+corner.R3+corner.R4, totalN);
    fprintf("COG: x=%.1f mm, y=%.1f mm\n", cog.x_mm, cog.y_mm);
end

stress = stress_and_fos(diag.maxMoment_Nm, diag.maxShear_N, mat.Fy_MPa, sec, props);
fprintf("\n=== Results ===\n");
fprintf("Max shear     = %.2f N\n", diag.maxShear_N);
fprintf("Max moment    = %.2f N·m\n", diag.maxMoment_Nm);
fprintf("Max σ         = %.2f MPa\n", stress.sigma_MPa);
fprintf("Max τ         = %.2f MPa\n", stress.tau_MPa);
fprintf("SF bending    = %.2f\n", stress.SF_bending);
fprintf("SF shear      = %.2f\n", stress.SF_shear);
fprintf("SF governing  = %.2f (%s)\n", stress.SF, stress.governing);
fprintf("Max deflection= %.6f mm\n", diag.maxDeflection_mm);

%% ========================= PLOTS =========================
figure("Name", "Shear / Moment / Deflection", "Color", "w");
tiledlayout(3,1, "Padding", "compact", "TileSpacing", "compact");

nexttile;
plot(diag.x_mm, diag.V_N, "b-", "LineWidth", 1.5); grid on; hold on;
yline(0, "k:");
ylabel("V (N)"); title("Shear Force");
if isfield(diag, "supports_mm")
    for s = diag.supports_mm(:)'
        xline(s, ":", "Color", [0.5 0.5 0.5]);
    end
end

nexttile;
plot(diag.x_mm, diag.M_Nm, "g-", "LineWidth", 1.5); grid on; hold on;
yline(0, "k:");
ylabel("M (N·m)"); title("Bending Moment");

nexttile;
plot(diag.x_mm, diag.delta_mm, "Color", [1 0.45 0], "LineWidth", 1.5); grid on; hold on;
yline(0, "k:");
xlabel("Position (mm)"); ylabel("\delta (mm)"); title("Deflection");

if analysisType == "Base Frame"
    figure("Name", "Base Frame Plan — Reactions & Loads", "Color", "w");
    hold on; axis equal; grid on;
    L = frame.length_mm; W = frame.width_mm;
    plot([0 L L 0 0], [0 0 W W 0], "k-", "LineWidth", 2);

    % Sections
    for i = 1:size(sections,1)
        x0 = sections(i,1); x1 = sections(i,2);
        patch([x0 x1 x1 x0], [0 0 W W], [0.6 0.75 1], ...
            "FaceAlpha", 0.15, "EdgeColor", "none");
        text((x0+x1)/2, W*0.92, sprintf("S%d", i), ...
            "HorizontalAlignment", "center", "FontWeight", "bold");
    end

    % Loads
    for i = 1:numel(loads)
        [P, xc, yc] = load_centroid_N(loads(i), frame);
        if P <= 0, continue; end
        plot(xc, yc, "rv", "MarkerFaceColor", "r", "MarkerSize", 10);
        text(xc, yc + 0.04*W, sprintf("%s\n%.0f N", loads(i).name, P), ...
            "Color", "r", "HorizontalAlignment", "center", "FontSize", 8);
    end

    % Corners
    corners = [0 0 corner.R1; L 0 corner.R2; 0 W corner.R3; L W corner.R4];
    labels = ["R1","R2","R3","R4"];
    for i = 1:4
        quiver(corners(i,1), corners(i,2), 0, 0.08*W, 0, ...
            "Color", [0.1 0.6 0.2], "LineWidth", 1.8, "MaxHeadSize", 0.8);
        text(corners(i,1), corners(i,2) - 0.06*W, ...
            sprintf("%s=%.0f N", labels(i), corners(i,3)), ...
            "HorizontalAlignment", "center", "Color", [0.1 0.45 0.15]);
    end

    if ~isempty(cog)
        plot(cog.x_mm, cog.y_mm, "o", "Color", [1 0.45 0], ...
            "MarkerFaceColor", [1 0.55 0], "MarkerSize", 10);
        text(cog.x_mm, cog.y_mm + 0.06*W, "COG", "Color", [0.9 0.4 0], ...
            "HorizontalAlignment", "center", "FontWeight", "bold");
    end
    xlabel("Length (mm)"); ylabel("Width (mm)");
    title("Frame plan: sections, loads, corner reactions, COG");
    xlim([-0.1*L, 1.1*L]); ylim([-0.2*W, 1.2*W]);
end

figure("Name", "Safety Factor", "Color", "w");
bar([stress.SF_bending, stress.SF_shear, stress.SF]);
set(gca, "XTickLabel", {"Bending", "Shear", "Governing"});
ylabel("Safety Factor"); grid on;
title(sprintf("Governing: %s (F_y = %.0f MPa)", stress.governing, mat.Fy_MPa));
yline(2, "r--", "SF = 2 screening");

fprintf("\nDone. Edit INPUTS at top of baseframe_calculator.m and re-run.\n");

%% ========================= LOCAL FUNCTIONS =========================
function props = section_properties(sec)
h = sec.h_mm/1000; bf = sec.bf_mm/1000; tf = sec.tf_mm/1000; tw = sec.tw_mm/1000;
b = sec.b_mm/1000; d = sec.d_mm/1000;
switch sec.kind
    case "Rectangular"
        A = b*h; I = b*h^3/12; S = I/(h/2); hw = h;
    case {"I Beam","C Channel"}
        hw = max(0, h - 2*tf);
        A = 2*bf*tf + hw*tw;
        Ifl = bf*tf^3/12 + bf*tf*((h-tf)/2)^2;
        I = 2*Ifl + tw*hw^3/12;
        S = I/(h/2);
    case "Circular"
        A = pi*(d/2)^2; I = pi*d^4/64; S = I/(d/2); hw = d;
    otherwise
        error("Unknown section kind");
end
props = struct("A", A, "I", I, "S", S, "webHeight", hw, "tw", tw);
end

function [P, xc, yc] = load_centroid_N(load, frame)
yc = frame.width_mm/2;
switch load.type
    case "Point"
        P = force_to_N(load.magnitude, load.unit);
        xc = load.start_mm;
    case "Uniform"
        w = force_to_N(load.magnitude, load.unit); % N/m
        L = (load.end_mm - load.start_mm)/1000;
        P = w * L;
        xc = (load.start_mm + load.end_mm)/2;
    case "Distributed"
        if load.unit == "kg" || load.unit == "lbs"
            P = force_to_N(load.magnitude, load.unit);
        else
            % N interpreted as pressure N/m^2
            area = (load.length_mm * load.width_mm) / 1e6;
            P = force_to_N(load.magnitude, "N") * area;
        end
        xc = load.start_mm + load.length_mm/2;
        yc = frame.width_mm/2; % centered (matches app)
    otherwise
        P = 0; xc = 0; yc = frame.width_mm/2;
end
end

function N = force_to_N(mag, unit)
switch string(unit)
    case "kg", N = mag * 9.81;
    case "lbs", N = mag * 4.44822;
    otherwise, N = mag;
end
end

function [diag, R] = analyze_simple_beam(beam, loads, E, I)
Lmm = beam.length_mm; left = beam.left_mm; right = beam.right_mm;
L = (right-left)/1000;
n = 200;
x_mm = linspace(0, Lmm, n)';
V = zeros(n,1); M = zeros(n,1); d = zeros(n,1);

% Normalize loads to points + UDL segments (meters, absolute coords)
[points, udls] = normalize_loads(loads);
R = span_reactions(left/1000, right/1000, points, udls);

for i = 1:n
    x = x_mm(i)/1000;
    V(i) = shear_at(x, left/1000, right/1000, R.left, R.right, points, udls);
    M(i) = moment_at(x, left/1000, right/1000, R.left, R.right, points, udls);
end

% Deflection between supports
mask = x_mm >= left & x_mm <= right;
xs = (x_mm(mask) - left)/1000;
Ms = M(mask);
deltas = integrate_deflection(xs, Ms, E, I);
d(mask) = deltas * 1000; % mm

diag = struct();
diag.x_mm = x_mm;
diag.V_N = V;
diag.M_Nm = M;
diag.delta_mm = d;
diag.maxShear_N = max(abs(V));
diag.maxMoment_Nm = max(abs(M));
diag.maxDeflection_mm = max(abs(d));
diag.supports_mm = [left, right];
end

function [corner, cog, totalN] = analyze_base_frame_corners(frame, sections, loads, roof_kg, other_kg)
L = frame.length_mm/1000; W = frame.width_mm/1000;
R1=0; R2=0; R3=0; R4=0;
items = []; % for COG: [mass_kg, x_mm, y_mm]

    function add_to_corners(P, x, y)
        a1 = (L-x)*(W-y); a2 = x*(W-y); a3 = (L-x)*y; a4 = x*y;
        At = L*W;
        if At <= 0, return; end
        R1 = R1 + P*a1/At; R2 = R2 + P*a2/At;
        R3 = R3 + P*a3/At; R4 = R4 + P*a4/At;
        items = [items; P/9.81, x*1000, y*1000]; %#ok<AGROW>
    end

totalN = 0;
for i = 1:numel(loads)
    [P, xc, yc] = load_centroid_N(loads(i), frame);
    add_to_corners(P, xc/1000, yc/1000);
    totalN = totalN + P;
end

roofN = roof_kg * 9.81;
if ~isempty(sections)
    lenTot = sum(sections(:,2)-sections(:,1));
    for i = 1:size(sections,1)
        xmid = (sections(i,1)+sections(i,2))/2/1000;
        casingN = sections(i,3)*9.81;
        baseN = sections(i,4)*9.81;
        secLen = sections(i,2)-sections(i,1);
        roofSec = 0;
        if lenTot > 0 && roofN > 0
            roofSec = roofN * secLen / lenTot;
        end
        add_to_corners(casingN + roofSec, xmid, W/2);
        add_to_corners(baseN, xmid, W/2);
        totalN = totalN + casingN + roofSec + baseN;
    end
else
    % no sections: put roof/other at center
end

otherN = other_kg * 9.81;
if otherN > 0
    add_to_corners(otherN, L/2, W/2);
    totalN = totalN + otherN;
end

corner = struct("R1",R1,"R2",R2,"R3",R3,"R4",R4);
if isempty(items)
    cog = struct("x_mm", frame.length_mm/2, "y_mm", frame.width_mm/2);
else
    m = items(:,1); 
    cog = struct( ...
        "x_mm", sum(m.*items(:,2))/sum(m), ...
        "y_mm", sum(m.*items(:,3))/sum(m));
end
end

function [diag, meta] = analyze_multispan_frame(frame, sections, loads, supports_mm, roof_kg, other_kg, E, I)
% Build line loads on ONE longitudinal beam (50% share, like the app)
share = 0.5;
lineSegs = []; % [start_mm end_mm w_N_per_m]
pts = [];     % [x_mm Force_N]

for i = 1:numel(loads)
    if loads(i).type ~= "Distributed", continue; end
    [P, ~, ~] = load_centroid_N(loads(i), frame);
    len = loads(i).length_mm;
    if ~(len > 0), continue; end
    w = (P * share) / (len/1000);
    lineSegs = [lineSegs; loads(i).start_mm, loads(i).start_mm+len, w]; %#ok<AGROW>
end

roofN = roof_kg*9.81;
lenTot = frame.length_mm;
if ~isempty(sections)
    for i = 1:size(sections,1)
        a = sections(i,1); b = sections(i,2); Lm = (b-a)/1000;
        if Lm <= 0, continue; end
        casing = sections(i,3)*9.81*share;
        base = sections(i,4)*9.81*share;
        roof = 0;
        if lenTot > 0
            roof = roofN * ((b-a)/lenTot) * share;
        end
        w = (casing+base+roof)/Lm;
        lineSegs = [lineSegs; a, b, w]; %#ok<AGROW>
    end
end
if other_kg > 0
    pts = [pts; frame.length_mm/2, other_kg*9.81*share]; %#ok<AGROW>
end

supports = unique(sort(supports_mm(:)'));
if supports(1) ~= 0, supports = [0 supports]; end
if supports(end) ~= frame.length_mm, supports = [supports frame.length_mm]; end

x_all = []; V_all = []; M_all = []; d_all = [];
maxV = 0; maxM = 0; maxD = 0;

for s = 1:numel(supports)-1
    a = supports(s); b = supports(s+1);
    Lm = (b-a)/1000;
    if Lm <= 0, continue; end

    % Clip loads to span (local meters)
    udls = [];
    for k = 1:size(lineSegs,1)
        s0 = max(lineSegs(k,1), a); s1 = min(lineSegs(k,2), b);
        if s1 > s0
            udls = [udls; (s0-a)/1000, (s1-a)/1000, lineSegs(k,3)]; %#ok<AGROW>
        end
    end
    points = [];
    for k = 1:size(pts,1)
        if pts(k,1) >= a && pts(k,1) <= b
            points = [points; (pts(k,1)-a)/1000, pts(k,2)]; %#ok<AGROW>
        end
    end

    R = span_reactions_local(Lm, points, udls);
    n = max(40, round(80*Lm));
    xl = linspace(0, Lm, n)';
    V = zeros(n,1); M = zeros(n,1);
    for i = 1:n
        V(i) = shear_local(xl(i), R.left, points, udls);
        M(i) = moment_local(xl(i), R.left, points, udls);
    end
    delta = integrate_deflection(xl, M, E, I) * 1000; % mm

    x_all = [x_all; a + xl*1000; nan]; %#ok<AGROW>
    V_all = [V_all; V; nan]; %#ok<AGROW>
    M_all = [M_all; M; nan]; %#ok<AGROW>
    d_all = [d_all; delta; nan]; %#ok<AGROW>
    maxV = max(maxV, max(abs(V)));
    maxM = max(maxM, max(abs(M)));
    maxD = max(maxD, max(abs(delta)));
end

diag = struct("x_mm", x_all, "V_N", V_all, "M_Nm", M_all, "delta_mm", d_all, ...
    "maxShear_N", maxV, "maxMoment_Nm", maxM, "maxDeflection_mm", maxD, ...
    "supports_mm", supports);
meta = struct("lineSegs", lineSegs, "points", pts);
end

function [points, udls] = normalize_loads(loads)
points = []; % [x_m, F_N]
udls = [];   % [start_m, end_m, w_N_per_m]
for i = 1:numel(loads)
    L = loads(i);
    switch L.type
        case "Point"
            points = [points; L.start_mm/1000, force_to_N(L.magnitude, L.unit)]; %#ok<AGROW>
        case "Uniform"
            udls = [udls; L.start_mm/1000, L.end_mm/1000, force_to_N(L.magnitude, L.unit)]; %#ok<AGROW>
        case "Distributed"
            if L.unit == "kg" || L.unit == "lbs"
                P = force_to_N(L.magnitude, L.unit);
            else
                P = force_to_N(L.magnitude, "N") * (L.length_mm*L.width_mm)/1e6;
            end
            a = L.start_mm/1000; b = a + L.length_mm/1000;
            w = P / max(b-a, eps);
            udls = [udls; a, b, w]; %#ok<AGROW>
    end
end
end

function R = span_reactions(left, right, points, udls)
span = right - left;
Rl = 0; Rr = 0;
for i = 1:size(points,1)
    a = points(i,1) - left; b = right - points(i,1); P = points(i,2);
    Rl = Rl + P*b/span; Rr = Rr + P*a/span;
end
for i = 1:size(udls,1)
    s0 = max(udls(i,1), left); s1 = min(udls(i,2), right);
    if s1 <= s0, continue; end
    w = udls(i,3); Len = s1-s0; P = w*Len; c = (s0+s1)/2;
    a = c-left; b = right-c;
    Rl = Rl + P*b/span; Rr = Rr + P*a/span;
end
R = struct("left", Rl, "right", Rr);
end

function R = span_reactions_local(L, points, udls)
total = 0; mom = 0;
for i = 1:size(points,1)
    total = total + points(i,2); mom = mom + points(i,2)*points(i,1);
end
for i = 1:size(udls,1)
    Len = udls(i,2)-udls(i,1); P = udls(i,3)*Len; c = (udls(i,1)+udls(i,2))/2;
    total = total + P; mom = mom + P*c;
end
Rr = mom / max(L, eps); Rl = total - Rr;
R = struct("left", Rl, "right", Rr);
end

function V = shear_at(x, left, right, Rl, Rr, points, udls)
V = 0;
if x >= left, V = V + Rl; end
if x >= right, V = V - Rr; end
for i = 1:size(points,1)
    if x > points(i,1), V = V - points(i,2); end
end
for i = 1:size(udls,1)
    if x > udls(i,1)
        loaded = min(x, udls(i,2)) - udls(i,1);
        V = V - udls(i,3)*loaded;
    end
end
end

function M = moment_at(x, left, right, Rl, Rr, points, udls)
M = 0;
if x >= left, M = M + Rl*(x-left); end
if x >= right, M = M - Rr*(x-right); end
for i = 1:size(points,1)
    if x > points(i,1), M = M - points(i,2)*(x-points(i,1)); end
end
for i = 1:size(udls,1)
    if x > udls(i,1)
        loadedTo = min(x, udls(i,2));
        Len = loadedTo - udls(i,1);
        c = udls(i,1) + Len/2;
        M = M - udls(i,3)*Len*(x-c);
    end
end
end

function V = shear_local(x, Rl, points, udls)
V = Rl;
for i = 1:size(points,1)
    if x > points(i,1), V = V - points(i,2); end
end
for i = 1:size(udls,1)
    if x > udls(i,1)
        loaded = min(x, udls(i,2)) - udls(i,1);
        V = V - udls(i,3)*loaded;
    end
end
end

function M = moment_local(x, Rl, points, udls)
M = Rl*x;
for i = 1:size(points,1)
    if x > points(i,1), M = M - points(i,2)*(x-points(i,1)); end
end
for i = 1:size(udls,1)
    if x > udls(i,1)
        loadedTo = min(x, udls(i,2));
        Len = loadedTo - udls(i,1);
        c = udls(i,1) + Len/2;
        M = M - udls(i,3)*Len*(x-c);
    end
end
end

function d = integrate_deflection(xs, M, E, I)
n = numel(xs);
if n < 2 || E <= 0 || I <= 0, d = zeros(size(xs)); return; end
kappa = M ./ (E*I);
theta = zeros(n,1); delta = zeros(n,1);
for i = 2:n
    h = xs(i)-xs(i-1);
    theta(i) = theta(i-1) + 0.5*(kappa(i-1)+kappa(i))*h;
end
for i = 2:n
    h = xs(i)-xs(i-1);
    delta(i) = delta(i-1) + 0.5*(theta(i-1)+theta(i))*h;
end
L = xs(end)-xs(1);
d = delta - ((xs-xs(1))/L) * delta(end); % pin both ends
end

function out = stress_and_fos(M, V, Fy, sec, props)
sigma = 0; if props.S > 0, sigma = M / props.S / 1e6; end
switch sec.kind
    case "Circular"
        tau = 0; if props.A > 0, tau = (4/3)*abs(V)/props.A/1e6; end
    case {"I Beam","C Channel"}
        Aw = props.tw * props.webHeight;
        if Aw > 0, tau = abs(V)/Aw/1e6; else, tau = 0; end
    otherwise
        tau = 0; if props.A > 0, tau = 1.5*abs(V)/props.A/1e6; end
end
SFb = 0; if sigma > 0, SFb = Fy/sigma; end
SFs = 0; Fv = Fy/sqrt(3); if tau > 0, SFs = Fv/tau; end
cands = [];
if SFb > 0, cands(end+1,:) = [SFb, 1]; end %#ok<AGROW>
if SFs > 0, cands(end+1,:) = [SFs, 2]; end %#ok<AGROW>
if isempty(cands)
    SF = 0; gov = "none";
else
    [SF, ix] = min(cands(:,1));
    if cands(ix,2) == 1, gov = "bending"; else, gov = "shear"; end
end
out = struct("sigma_MPa", sigma, "tau_MPa", tau, ...
    "SF_bending", SFb, "SF_shear", SFs, "SF", SF, "governing", gov);
end
