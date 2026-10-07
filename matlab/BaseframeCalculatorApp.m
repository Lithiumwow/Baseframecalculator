function BaseframeCalculatorApp
%BASEFRAMECALCULATORAPP Interactive GUI for baseframe / beam load analysis.
%   Run:  BaseframeCalculatorApp
%   Enter dimensions, section, material, sections table, and loads table,
%   then click Calculate.

    %% -------------------- App window --------------------
    fig = uifigure("Name", "Baseframe Load Calculator", ...
        "Position", [60 40 1280 820], "Color", [0.96 0.97 0.98]);

    gl = uigridlayout(fig, [1 2]);
    gl.ColumnWidth = {420, "1x"};
    gl.Padding = [12 12 12 12];
    gl.ColumnSpacing = 14;

    %% -------------------- Left: inputs --------------------
    left = uigridlayout(gl, [12 1]);
    left.RowHeight = {28, 36, 28, 90, 28, 110, 28, 160, 28, 120, 40, 28};
    left.Padding = [0 0 0 0];
    left.RowSpacing = 6;

    uilabel(left, "Text", "Analysis", "FontWeight", "bold", "FontSize", 13);

    row1 = uigridlayout(left, [1 2]);
    row1.ColumnWidth = {"1x", "1x"};
    % uidropdown Items must be a string array OR a cell of char vectors —
    % not a cell array of strings ({"a","b"} fails).
    ddAnalysis = uidropdown(row1, ...
        "Items", ["Base Frame", "Simple Beam"], ...
        "Value", "Base Frame");
    ddMaterial = uidropdown(row1, ...
        "Items", ["ASTM A36 (250 MPa)", "ASTM A992 / A572-50 (345 MPa)", "Custom"], ...
        "Value", "ASTM A36 (250 MPa)");

    uilabel(left, "Text", "Geometry & supports (mm)", "FontWeight", "bold");

    geo = uigridlayout(left, [3 4]);
    geo.ColumnWidth = {90, "1x", 90, "1x"};
    geo.RowHeight = {28, 28, 28};
    uilabel(geo, "Text", "Frame L");
    efFrameL = uieditfield(geo, "numeric", "Value", 1980, "Limits", [1 Inf]);
    uilabel(geo, "Text", "Frame W");
    efFrameW = uieditfield(geo, "numeric", "Value", 1082, "Limits", [1 Inf]);
    uilabel(geo, "Text", "Beam L");
    efBeamL = uieditfield(geo, "numeric", "Value", 2000, "Limits", [1 Inf]);
    uilabel(geo, "Text", "Left supp.");
    efLeft = uieditfield(geo, "numeric", "Value", 0, "Limits", [0 Inf]);
    uilabel(geo, "Text", "Right supp.");
    efRight = uieditfield(geo, "numeric", "Value", 2000, "Limits", [0 Inf]);
    uilabel(geo, "Text", "Legs (mm)");
    efLegs = uieditfield(geo, "text", "Value", "0, 800, 1200, 1980");

    uilabel(left, "Text", "Beam cross-section", "FontWeight", "bold");

    sec = uigridlayout(left, [3 4]);
    sec.ColumnWidth = {90, "1x", 90, "1x"};
    sec.RowHeight = {28, 28, 28};
    uilabel(sec, "Text", "Profile");
    ddSection = uidropdown(sec, ...
        "Items", ["C Channel", "I Beam", "Rectangular", "Circular"], ...
        "Value", "C Channel");
    uilabel(sec, "Text", "Fy (MPa)");
    efFy = uieditfield(sec, "numeric", "Value", 250, "Limits", [1 Inf]);
    uilabel(sec, "Text", "H / D (mm)");
    efH = uieditfield(sec, "numeric", "Value", 218, "Limits", [1 Inf]);
    uilabel(sec, "Text", "bf / b (mm)");
    efBf = uieditfield(sec, "numeric", "Value", 66, "Limits", [0.1 Inf]);
    uilabel(sec, "Text", "tf (mm)");
    efTf = uieditfield(sec, "numeric", "Value", 3, "Limits", [0.1 Inf]);
    uilabel(sec, "Text", "tw (mm)");
    efTw = uieditfield(sec, "numeric", "Value", 5, "Limits", [0.1 Inf]);

    uilabel(left, "Text", "Sections  [start_mm | end_mm | casing_kg | baseframe_kg]", ...
        "FontWeight", "bold");
    tblSections = uitable(left, ...
        "ColumnName", {"Start mm", "End mm", "Casing kg", "Baseframe kg"}, ...
        "ColumnEditable", true(1,4), ...
        "Data", [
            0, 800, 50, 40
            800, 1200, 40, 30
            1200, 1980, 55, 45
        ]);

    uilabel(left, "Text", "Loads  (Distributed uses Length/Width; Uniform uses End)", ...
        "FontWeight", "bold");
    tblLoads = uitable(left, ...
        "ColumnName", {"Name", "Type", "Mag", "Unit", "Start mm", "End/Len mm", "Width mm"}, ...
        "ColumnEditable", [true true true true true true true], ...
        "ColumnFormat", {
            "char",
            {"Point", "Uniform", "Distributed"},
            "numeric",
            {"kg", "lbs", "N"},
            "numeric", "numeric", "numeric"
        }, ...
        "Data", {
            "Filter", "Distributed", 80, "kg", 100, 400, 1082
            "Fan", "Point", 200, "kg", 1000, 0, 0
            "Coil", "Distributed", 120, "kg", 1400, 500, 1082
        });

    extras = uigridlayout(left, [2 4]);
    extras.ColumnWidth = {100, "1x", 100, "1x"};
    extras.RowHeight = {28, 28};
    uilabel(extras, "Text", "Roof kg");
    efRoof = uieditfield(extras, "numeric", "Value", 0, "Limits", [0 Inf]);
    uilabel(extras, "Text", "Other kg");
    efOther = uieditfield(extras, "numeric", "Value", 0, "Limits", [0 Inf]);
    uilabel(extras, "Text", "E (GPa)");
    efE = uieditfield(extras, "numeric", "Value", 200, "Limits", [1 Inf]);
    uilabel(extras, "Text", "");
    uilabel(extras, "Text", "Share 0.5 on one long rail (app model)", "FontColor", [0.35 0.4 0.45]);

    btnRow = uigridlayout(left, [1 3]);
    btnRow.ColumnWidth = {"1x", "1x", "1x"};
    btnCalc = uibutton(btnRow, "Text", "Calculate", ...
        "BackgroundColor", [0.15 0.35 0.75], "FontColor", "w", "FontWeight", "bold");
    btnAddLoad = uibutton(btnRow, "Text", "Add load");
    btnAddSec = uibutton(btnRow, "Text", "Add section");

    lblStatus = uilabel(left, "Text", "Ready. Edit inputs, then Calculate.", ...
        "FontColor", [0.25 0.3 0.35]);

    %% -------------------- Right: plots + results --------------------
    right = uigridlayout(gl, [2 1]);
    right.RowHeight = {110, "1x"};
    right.Padding = [0 0 0 0];
    right.RowSpacing = 8;

    resultsPanel = uipanel(right, "Title", "Results", "FontWeight", "bold", ...
        "BackgroundColor", [1 1 1]);
    resGrid = uigridlayout(resultsPanel, [2 4]);
    resGrid.Padding = [8 8 8 8];
    lblR = gobjects(2,4);
    titles = {
        "Max Shear (N)", "Max Moment (N·m)", "σ (MPa)", "τ (MPa)"
        "SF bending", "SF shear", "SF governing", "δ max (mm)"
    };
    for r = 1:2
        for c = 1:4
            p = uigridlayout(resGrid, [2 1]);
            p.RowHeight = {18, "1x"};
            p.Padding = [0 0 0 0];
            uilabel(p, "Text", titles{r,c}, "FontSize", 11, "FontColor", [0.4 0.45 0.5]);
            lblR(r,c) = uilabel(p, "Text", "—", "FontSize", 18, "FontWeight", "bold");
        end
    end

    tabGroup = uitabgroup(right);
    tabVMD = uitab(tabGroup, "Title", "V / M / δ");
    tabPlan = uitab(tabGroup, "Title", "Frame plan");
    tabSF = uitab(tabGroup, "Title", "Safety factor");

    axV = uiaxes(tabVMD); axV.Position = [40 360 760 200];
    axM = uiaxes(tabVMD); axM.Position = [40 190 760 160];
    axD = uiaxes(tabVMD); axD.Position = [40 20 760 160];
    style_axes(axV); style_axes(axM); style_axes(axD);

    axPlan = uiaxes(tabPlan);
    axPlan.Units = "normalized";
    axPlan.Position = [0.06 0.08 0.88 0.86];
    style_axes(axPlan);

    axSF = uiaxes(tabSF);
    axSF.Units = "normalized";
    axSF.Position = [0.12 0.12 0.76 0.78];
    style_axes(axSF);

    %% -------------------- Callbacks --------------------
    ddMaterial.ValueChangedFcn = @(~,~) on_material();
    btnAddLoad.ButtonPushedFcn = @(~,~) add_load_row();
    btnAddSec.ButtonPushedFcn = @(~,~) add_section_row();
    btnCalc.ButtonPushedFcn = @(~,~) run_calc();

    % Initial draw
    run_calc();

    %% -------------------- Nested helpers --------------------
    function on_material()
        switch ddMaterial.Value
            case "ASTM A36 (250 MPa)", efFy.Value = 250;
            case "ASTM A992 / A572-50 (345 MPa)", efFy.Value = 345;
            otherwise
                % keep custom Fy
        end
    end

    function add_load_row()
        d = tblLoads.Data;
        if isempty(d), d = {}; end
        d(end+1,:) = {"New load", "Point", 100, "kg", 500, 0, efFrameW.Value}; %#ok<AGROW>
        tblLoads.Data = d;
    end

    function add_section_row()
        d = tblSections.Data;
        if isempty(d)
            d = [0, 1000, 0, 0];
        else
            lastEnd = d(end,2);
            d = [d; lastEnd, lastEnd+500, 0, 0]; %#ok<AGROW>
        end
        tblSections.Data = d;
        efLegs.Value = sprintf("%.0f, ", [0; d(:,2)]);
        efLegs.Value = efLegs.Value(1:end-2);
    end

    function run_calc()
        try
            lblStatus.Text = "Calculating…";
            drawnow;

            analysis = string(ddAnalysis.Value);
            frame.length_mm = efFrameL.Value;
            frame.width_mm = efFrameW.Value;
            beam.length_mm = efBeamL.Value;
            beam.left_mm = efLeft.Value;
            beam.right_mm = efRight.Value;

            secIn.kind = string(ddSection.Value);
            secIn.h_mm = efH.Value;
            secIn.bf_mm = efBf.Value;
            secIn.tf_mm = efTf.Value;
            secIn.tw_mm = efTw.Value;
            secIn.b_mm = efBf.Value;
            secIn.d_mm = efH.Value;

            mat.Fy_MPa = efFy.Value;
            mat.E_GPa = efE.Value;
            E = mat.E_GPa * 1e9;
            props = section_properties(secIn);

            loads = table_to_loads(tblLoads.Data, frame.width_mm);
            sections = tblSections.Data;
            if isempty(sections), sections = zeros(0,4); end
            legs = parse_legs(efLegs.Value, frame.length_mm);

            roof_kg = efRoof.Value;
            other_kg = efOther.Value;

            if analysis == "Simple Beam"
                [diag, R] = analyze_simple_beam(beam, loads, E, props.I);
                corner = [];
                cog = [];
                extraMsg = sprintf("R_left=%.1f N, R_right=%.1f N", R.left, R.right);
            else
                [corner, cog, totalN] = analyze_base_frame_corners(frame, sections, loads, roof_kg, other_kg);
                [diag, ~] = analyze_multispan_frame(frame, sections, loads, legs, roof_kg, other_kg, E, props.I);
                extraMsg = sprintf("ΣR=%.1f N | total=%.1f N | COG (%.0f, %.0f) mm", ...
                    corner.R1+corner.R2+corner.R3+corner.R4, totalN, cog.x_mm, cog.y_mm);
            end

            stress = stress_and_fos(diag.maxMoment_Nm, diag.maxShear_N, mat.Fy_MPa, secIn, props);

            lblR(1,1).Text = sprintf("%.1f", diag.maxShear_N);
            lblR(1,2).Text = sprintf("%.1f", diag.maxMoment_Nm);
            lblR(1,3).Text = sprintf("%.2f", stress.sigma_MPa);
            lblR(1,4).Text = sprintf("%.2f", stress.tau_MPa);
            lblR(2,1).Text = sprintf("%.2f", stress.SF_bending);
            lblR(2,2).Text = sprintf("%.2f", stress.SF_shear);
            lblR(2,3).Text = sprintf("%.2f (%s)", stress.SF, stress.governing);
            lblR(2,4).Text = sprintf("%.5g", diag.maxDeflection_mm);

            plot_vmd(axV, axM, axD, diag);
            plot_plan(axPlan, analysis, frame, beam, sections, loads, corner, cog);
            plot_sf(axSF, stress, mat.Fy_MPa);

            lblStatus.Text = "OK — " + extraMsg;
            lblStatus.FontColor = [0.1 0.45 0.2];
        catch ME
            lblStatus.Text = "Error: " + ME.message;
            lblStatus.FontColor = [0.75 0.15 0.1];
        end
    end
end

%% ===================== Plot helpers =====================
function style_axes(ax)
    ax.Color = [1 1 1];
    ax.XGrid = "on";
    ax.YGrid = "on";
    ax.GridAlpha = 0.15;
    ax.Box = "on";
    ax.FontName = "Segoe UI";
    ax.FontSize = 11;
    ax.LineWidth = 0.8;
end

function plot_vmd(axV, axM, axD, diag)
    cla(axV); cla(axM); cla(axD);
    x = diag.x_mm(:); V = diag.V_N(:); M = diag.M_Nm(:); d = diag.delta_mm(:);

    plot(axV, x, V, "Color", [0.35 0.40 0.85], "LineWidth", 1.8);
    yline(axV, 0, ":", "Color", [0.4 0.4 0.4]);
    if isfield(diag, "supports_mm")
        for s = diag.supports_mm(:)'
            xline(axV, s, ":", "Color", [0.7 0.7 0.7]);
        end
    end
    ylabel(axV, "Shear V (N)");
    title(axV, "Shear force diagram", "FontWeight", "bold");
    axV.XTickLabel = {};

    plot(axM, x, M, "Color", [0.20 0.65 0.40], "LineWidth", 1.8);
    yline(axM, 0, ":", "Color", [0.4 0.4 0.4]);
    if isfield(diag, "supports_mm")
        for s = diag.supports_mm(:)'
            xline(axM, s, ":", "Color", [0.7 0.7 0.7]);
        end
    end
    ylabel(axM, "Moment M (N·m)");
    title(axM, "Bending moment diagram", "FontWeight", "bold");
    axM.XTickLabel = {};

    plot(axD, x, d, "Color", [0.95 0.45 0.10], "LineWidth", 1.8);
    yline(axD, 0, ":", "Color", [0.4 0.4 0.4]);
    xlabel(axD, "Position along length (mm)");
    ylabel(axD, "Deflection δ (mm)");
    title(axD, "Deflection diagram", "FontWeight", "bold");

    linkaxes([axV axM axD], "x");
end

function plot_plan(ax, analysis, frame, beam, sections, loads, corner, cog)
    cla(ax); hold(ax, "on");
    if analysis == "Simple Beam"
        L = beam.length_mm;
        plot(ax, [0 L], [0 0], "k-", "LineWidth", 3);
        plot(ax, [beam.left_mm, beam.right_mm], [0 0], "v", ...
            "MarkerSize", 10, "MarkerFaceColor", [0.2 0.55 0.3], "Color", [0.2 0.55 0.3]);
        for i = 1:numel(loads)
            [P, xc] = load_force_x(loads(i), frame);
            if P <= 0, continue; end
            quiver(ax, xc, 0.15*L, 0, -0.12*L, 0, "r", "LineWidth", 1.5, "MaxHeadSize", 0.6);
            text(ax, xc, 0.18*L, sprintf("%s\n%.0f N", loads(i).name, P), ...
                "Color", "r", "HorizontalAlignment", "center", "FontSize", 9);
        end
        axis(ax, "equal");
        xlim(ax, [-0.05*L, 1.05*L]); ylim(ax, [-0.25*L, 0.35*L]);
        title(ax, "Simple beam layout", "FontWeight", "bold");
        xlabel(ax, "x (mm)");
        return;
    end

    L = frame.length_mm; W = frame.width_mm;
    fill(ax, [0 L L 0], [0 0 W W], [0.93 0.95 0.98], "EdgeColor", [0.15 0.2 0.25], "LineWidth", 1.8);

    cmap = lines(max(size(sections,1),1));
    for i = 1:size(sections,1)
        x0 = sections(i,1); x1 = sections(i,2);
        patch(ax, [x0 x1 x1 x0], [0.03*W 0.03*W 0.97*W 0.97*W], cmap(i,:), ...
            "FaceAlpha", 0.18, "EdgeColor", "none");
        plot(ax, [x0 x0], [0 W], "-", "Color", [0.3 0.35 0.4], "LineWidth", 1);
        text(ax, (x0+x1)/2, 0.92*W, sprintf("Section %d", i), ...
            "HorizontalAlignment", "center", "FontWeight", "bold", "FontSize", 10);
    end

    for i = 1:numel(loads)
        [P, xc, yc] = load_centroid_N(loads(i), frame);
        if P <= 0, continue; end
        plot(ax, xc, yc, "v", "MarkerSize", 11, "MarkerFaceColor", [0.9 0.2 0.2], "Color", [0.7 0.1 0.1]);
        text(ax, xc, yc + 0.07*W, sprintf("%s\n%.0f N", loads(i).name, P), ...
            "Color", [0.75 0.1 0.1], "HorizontalAlignment", "center", "FontSize", 9);
    end

    if ~isempty(corner)
        pts = [0 0 corner.R1; L 0 corner.R2; 0 W corner.R3; L W corner.R4];
        names = ["R1","R2","R3","R4"];
        for i = 1:4
            quiver(ax, pts(i,1), pts(i,2), 0, 0.1*W*(2*(pts(i,2)==0)-1)*-1 + 0.1*W, 0, ...
                "Color", [0.1 0.55 0.25], "LineWidth", 1.6, "MaxHeadSize", 0.8);
            % simpler: always draw upward from corner
        end
        % redraw clean upward reaction markers
        for i = 1:4
            plot(ax, pts(i,1), pts(i,2), "s", "MarkerSize", 8, ...
                "MarkerFaceColor", [0.2 0.7 0.35], "Color", [0.1 0.45 0.2]);
            text(ax, pts(i,1), pts(i,2) - 0.08*W, sprintf("%s\n%.0f N", names(i), pts(i,3)), ...
                "HorizontalAlignment", "center", "Color", [0.1 0.4 0.18], "FontSize", 9);
        end
    end

    if ~isempty(cog)
        plot(ax, cog.x_mm, cog.y_mm, "o", "MarkerSize", 12, ...
            "MarkerFaceColor", [1 0.55 0.1], "Color", [0.85 0.4 0]);
        text(ax, cog.x_mm, cog.y_mm + 0.08*W, "COG", "Color", [0.85 0.4 0], ...
            "FontWeight", "bold", "HorizontalAlignment", "center");
    end

    axis(ax, "equal");
    xlim(ax, [-0.08*L, 1.08*L]);
    ylim(ax, [-0.18*W, 1.12*W]);
    xlabel(ax, "Length (mm)");
    ylabel(ax, "Width (mm)");
    title(ax, "Frame plan — sections, loads, corner reactions, COG", "FontWeight", "bold");
    hold(ax, "off");
end

function plot_sf(ax, stress, Fy)
    cla(ax);
    vals = [stress.SF_bending, stress.SF_shear, stress.SF];
    b = bar(ax, vals, 0.55);
    b.FaceColor = "flat";
    b.CData = [0.30 0.55 0.90; 0.20 0.70 0.45; 0.90 0.35 0.25];
    ax.XTick = 1:3;
    ax.XTickLabel = {"Bending", "Shear", "Governing"};
    ylabel(ax, "Safety factor");
    title(ax, sprintf("Yield screening (F_y = %.0f MPa)", Fy), "FontWeight", "bold");
    yline(ax, 2, "--", "SF = 2", "Color", [0.75 0.2 0.2], "LineWidth", 1.2);
    grid(ax, "on");
    for i = 1:3
        if vals(i) > 0
            text(ax, i, vals(i), sprintf("%.2f", vals(i)), ...
                "HorizontalAlignment", "center", "VerticalAlignment", "bottom", ...
                "FontWeight", "bold");
        end
    end
end

%% ===================== Input parsing =====================
function loads = table_to_loads(data, defaultWidth)
    if isempty(data)
        loads = struct("type", {}, "magnitude", {}, "unit", {}, "start_mm", {}, ...
            "end_mm", {}, "length_mm", {}, "width_mm", {}, "name", {});
        return;
    end
    n = size(data,1);
    loads = struct("type", cell(1,n), "magnitude", cell(1,n), "unit", cell(1,n), ...
        "start_mm", cell(1,n), "end_mm", cell(1,n), "length_mm", cell(1,n), ...
        "width_mm", cell(1,n), "name", cell(1,n));
    for i = 1:n
        loads(i).name = string(data{i,1});
        loads(i).type = string(data{i,2});
        loads(i).magnitude = double(data{i,3});
        loads(i).unit = string(data{i,4});
        loads(i).start_mm = double(data{i,5});
        val6 = double(data{i,6});
        val7 = double(data{i,7});
        if loads(i).type == "Uniform"
            loads(i).end_mm = val6;
            loads(i).length_mm = nan;
            loads(i).width_mm = nan;
        elseif loads(i).type == "Distributed"
            loads(i).length_mm = val6;
            loads(i).width_mm = val7;
            if ~(loads(i).width_mm > 0), loads(i).width_mm = defaultWidth; end
            loads(i).end_mm = nan;
        else
            loads(i).end_mm = nan;
            loads(i).length_mm = nan;
            loads(i).width_mm = nan;
        end
    end
end

function legs = parse_legs(txt, frameLen)
    parts = regexp(string(txt), "[,\s]+", "split");
    vals = [];
    for i = 1:numel(parts)
        if strlength(parts(i)) == 0, continue; end
        vals(end+1) = str2double(parts(i)); %#ok<AGROW>
    end
    vals = vals(~isnan(vals));
    legs = unique([0, vals, frameLen]);
end

function [P, xc] = load_force_x(load, frame)
    [P, xc, ~] = load_centroid_N(load, frame);
end

%% ===================== Engineering core =====================
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
            A = pi*(d/2)^2; I = pi*d^4/64; S = I/(d/2); hw = d; tw = d;
        otherwise
            error("Unknown section");
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
            w = force_to_N(load.magnitude, load.unit);
            Lm = (load.end_mm - load.start_mm)/1000;
            P = w * Lm;
            xc = (load.start_mm + load.end_mm)/2;
        case "Distributed"
            if load.unit == "kg" || load.unit == "lbs"
                P = force_to_N(load.magnitude, load.unit);
            else
                area = (load.length_mm * load.width_mm) / 1e6;
                P = force_to_N(load.magnitude, "N") * area;
            end
            xc = load.start_mm + load.length_mm/2;
        otherwise
            P = 0; xc = 0;
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
    n = 240;
    x_mm = linspace(0, Lmm, n)';
    V = zeros(n,1); M = zeros(n,1); d = zeros(n,1);
    [points, udls] = normalize_loads(loads);
    R = span_reactions(left/1000, right/1000, points, udls);
    for i = 1:n
        x = x_mm(i)/1000;
        V(i) = shear_at(x, left/1000, right/1000, R.left, R.right, points, udls);
        M(i) = moment_at(x, left/1000, right/1000, R.left, R.right, points, udls);
    end
    mask = x_mm >= left & x_mm <= right;
    xs = (x_mm(mask) - left)/1000;
    deltas = integrate_deflection(xs, M(mask), E, I);
    d(mask) = deltas * 1000;
    diag = struct("x_mm", x_mm, "V_N", V, "M_Nm", M, "delta_mm", d, ...
        "maxShear_N", max(abs(V)), "maxMoment_Nm", max(abs(M)), ...
        "maxDeflection_mm", max(abs(d)), "supports_mm", [left, right]);
end

function [corner, cog, totalN] = analyze_base_frame_corners(frame, sections, loads, roof_kg, other_kg)
    L = frame.length_mm/1000; W = frame.width_mm/1000;
    R1=0; R2=0; R3=0; R4=0; items = [];
    function add_to_corners(P, x, y)
        At = L*W;
        if At <= 0 || P == 0, return; end
        R1 = R1 + P*(L-x)*(W-y)/At;
        R2 = R2 + P*x*(W-y)/At;
        R3 = R3 + P*(L-x)*y/At;
        R4 = R4 + P*x*y/At;
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
            xmid = mean(sections(i,1:2))/1000;
            casingN = sections(i,3)*9.81;
            baseN = sections(i,4)*9.81;
            roofSec = 0;
            if lenTot > 0 && roofN > 0
                roofSec = roofN * (sections(i,2)-sections(i,1)) / lenTot;
            end
            add_to_corners(casingN + roofSec, xmid, W/2);
            add_to_corners(baseN, xmid, W/2);
            totalN = totalN + casingN + roofSec + baseN;
        end
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
        cog = struct("x_mm", sum(m.*items(:,2))/sum(m), "y_mm", sum(m.*items(:,3))/sum(m));
    end
end

function [diag, meta] = analyze_multispan_frame(frame, sections, loads, supports_mm, roof_kg, other_kg, E, I)
    share = 0.5;
    lineSegs = []; pts = [];
    for i = 1:numel(loads)
        if loads(i).type ~= "Distributed", continue; end
        [P, ~, ~] = load_centroid_N(loads(i), frame);
        len = loads(i).length_mm;
        if ~(len > 0), continue; end
        w = (P*share)/(len/1000);
        lineSegs = [lineSegs; loads(i).start_mm, loads(i).start_mm+len, w]; %#ok<AGROW>
    end
    % Point loads as concentrated line contributions on the rail
    for i = 1:numel(loads)
        if loads(i).type ~= "Point", continue; end
        P = force_to_N(loads(i).magnitude, loads(i).unit) * share;
        pts = [pts; loads(i).start_mm, P]; %#ok<AGROW>
    end
    for i = 1:numel(loads)
        if loads(i).type ~= "Uniform", continue; end
        w = force_to_N(loads(i).magnitude, loads(i).unit) * share; % N/m
        lineSegs = [lineSegs; loads(i).start_mm, loads(i).end_mm, w]; %#ok<AGROW>
    end

    roofN = roof_kg*9.81;
    if ~isempty(sections)
        for i = 1:size(sections,1)
            a = sections(i,1); b = sections(i,2); Lm = (b-a)/1000;
            if Lm <= 0, continue; end
            casing = sections(i,3)*9.81*share;
            base = sections(i,4)*9.81*share;
            roof = 0;
            if frame.length_mm > 0
                roof = roofN * ((b-a)/frame.length_mm) * share;
            end
            lineSegs = [lineSegs; a, b, (casing+base+roof)/Lm]; %#ok<AGROW>
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
        a = supports(s); b = supports(s+1); Lm = (b-a)/1000;
        if Lm <= 0, continue; end
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
        n = max(50, round(100*Lm));
        xl = linspace(0, Lm, n)';
        V = zeros(n,1); M = zeros(n,1);
        for i = 1:n
            V(i) = shear_local(xl(i), R.left, points, udls);
            M(i) = moment_local(xl(i), R.left, points, udls);
        end
        delta = integrate_deflection(xl, M, E, I) * 1000;
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
    points = []; udls = [];
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
                    P = force_to_N(L.magnitude, "N")*(L.length_mm*L.width_mm)/1e6;
                end
                a = L.start_mm/1000; b = a + L.length_mm/1000;
                udls = [udls; a, b, P/max(b-a, eps)]; %#ok<AGROW>
        end
    end
end

function R = span_reactions(left, right, points, udls)
    span = right - left; Rl = 0; Rr = 0;
    for i = 1:size(points,1)
        a = points(i,1)-left; b = right-points(i,1); P = points(i,2);
        Rl = Rl + P*b/span; Rr = Rr + P*a/span;
    end
    for i = 1:size(udls,1)
        s0 = max(udls(i,1), left); s1 = min(udls(i,2), right);
        if s1 <= s0, continue; end
        P = udls(i,3)*(s1-s0); c = (s0+s1)/2;
        Rl = Rl + P*(right-c)/span; Rr = Rr + P*(c-left)/span;
    end
    R = struct("left", Rl, "right", Rr);
end

function R = span_reactions_local(L, points, udls)
    total = 0; mom = 0;
    for i = 1:size(points,1)
        total = total + points(i,2); mom = mom + points(i,2)*points(i,1);
    end
    for i = 1:size(udls,1)
        Len = udls(i,2)-udls(i,1); P = udls(i,3)*Len; c = mean(udls(i,1:2));
        total = total + P; mom = mom + P*c;
    end
    Rr = mom/max(L,eps); Rl = total - Rr;
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
        if x > udls(i,1), V = V - udls(i,3)*(min(x,udls(i,2))-udls(i,1)); end
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
            Len = min(x,udls(i,2))-udls(i,1); c = udls(i,1)+Len/2;
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
        if x > udls(i,1), V = V - udls(i,3)*(min(x,udls(i,2))-udls(i,1)); end
    end
end

function M = moment_local(x, Rl, points, udls)
    M = Rl*x;
    for i = 1:size(points,1)
        if x > points(i,1), M = M - points(i,2)*(x-points(i,1)); end
    end
    for i = 1:size(udls,1)
        if x > udls(i,1)
            Len = min(x,udls(i,2))-udls(i,1); c = udls(i,1)+Len/2;
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
    d = delta - ((xs-xs(1))/max(L,eps))*delta(end);
end

function out = stress_and_fos(M, V, Fy, sec, props)
    sigma = 0; if props.S > 0, sigma = abs(M)/props.S/1e6; end
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
    vals = []; labels = {};
    if SFb > 0, vals(end+1) = SFb; labels{end+1} = "bending"; end %#ok<AGROW>
    if SFs > 0, vals(end+1) = SFs; labels{end+1} = "shear"; end %#ok<AGROW>
    if isempty(vals)
        SF = 0; gov = "none";
    else
        [SF, ix] = min(vals); gov = labels{ix};
    end
    out = struct("sigma_MPa", sigma, "tau_MPa", tau, ...
        "SF_bending", SFb, "SF_shear", SFs, "SF", SF, "governing", gov);
end
