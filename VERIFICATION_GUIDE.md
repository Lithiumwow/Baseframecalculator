# Verification Guide for Structural Analysis Plots

This guide helps you verify that the shear force, bending moment, and deflection diagrams are calculated correctly.

## 1. Basic Checks

### Force Equilibrium
- **Sum of all forces should equal zero**: ΣF = 0
  - For a simple beam: Sum of reactions = Sum of applied loads
  - For a baseframe: R1 + R2 + R3 + R4 = Total applied load
  - Check: Corner reactions should sum to the total weight applied

### Moment Equilibrium
- **Sum of all moments should equal zero**: ΣM = 0
  - For a simple beam: Moments about any point should balance
  - Check: At supports, the bending moment should be zero (or very close to zero)

### Safety Factor
- **Governing SF** = min(F_y/σ, (F_y/√3)/τ)
- Shear stress by section: rectangle 1.5V/A, circle (4/3)V/A, I/C channel V/(t_w·h_web)
- Distributed loads on simple beams are included as UDL segments (same solver as diagrams)
- Distributed footprints on the base frame are centered on frame width for corner reactions

## 2. Shear Force Diagram Verification

### Expected Behavior:
1. **At supports**: Shear force should equal the reaction force
   - Left support: V = R_left
   - Right support: V = -R_right (negative because it's opposite direction)

2. **Under point loads**: 
   - Shear force jumps by the magnitude of the load
   - Positive jump for downward loads

3. **Under uniform loads**:
   - Shear force changes linearly (slope = -w, where w is load intensity)
   - For distributed loads: slope = -w (load per unit length)

4. **Zero crossing**:
   - Where shear force crosses zero, bending moment is maximum
   - This should occur where the load is centered (for symmetric loads)

### Manual Calculation Example:
For a simply supported beam with:
- Length L = 2000 mm
- Point load P = 1000 N at center (x = 1000 mm)
- Reactions: R_left = R_right = 500 N

Expected shear force:
- At x = 0: V = 500 N
- At x < 1000: V = 500 N (constant)
- At x = 1000: V jumps from 500 N to -500 N
- At x > 1000: V = -500 N (constant)
- At x = 2000: V = -500 N

## 3. Bending Moment Diagram Verification

### Expected Behavior:
1. **At supports**: Bending moment = 0 (for simply supported beams)

2. **Maximum moment location**:
   - Occurs where shear force = 0
   - For point load at center: M_max at center = PL/4
   - For uniform load: M_max at center = wL²/8

3. **Shape**:
   - **Point loads**: Linear segments (triangular shape)
   - **Uniform loads**: Parabolic (quadratic)
   - **Distributed loads**: Curved (higher order polynomial)

4. **Sign convention**:
   - Positive moment: Compression on top (sagging beam)
   - Negative moment: Compression on bottom (hogging beam)

### Manual Calculation Example:
For the same beam as above:
- Maximum moment at center: M_max = PL/4 = (1000 N × 2000 mm) / 4 = 500,000 N·mm = 500 N·m

## 4. Deflection Diagram Verification

### Expected Behavior:
1. **At supports**: Deflection = 0 (for simply supported beams)

2. **Maximum deflection**:
   - Usually occurs at the center for symmetric loads
   - For point load at center: δ_max = PL³/(48EI)
   - For uniform load: δ_max = 5wL⁴/(384EI)

3. **Shape**:
   - Should be smooth and continuous
   - Should match the shape of the bending moment (integrated twice)

4. **Units**:
   - Check that deflection is in reasonable units (mm or m)
   - Typical deflections: 0.1-10 mm for small beams, up to L/250 for serviceability

### Manual Calculation Example:
For the same beam with:
- E = 200 GPa = 200,000 N/mm²
- I = 10,000,000 mm⁴ (example value)

Maximum deflection:
- δ_max = PL³/(48EI) = (1000 N × 2000³ mm³) / (48 × 200,000 N/mm² × 10,000,000 mm⁴)
- δ_max = 8,000,000,000,000 / 96,000,000,000,000 = 0.083 mm

## 5. Baseframe Specific Checks

### Corner Reactions:
1. **Symmetry**: For symmetric loads, opposite corners should have equal reactions
   - R1 = R3 (left side)
   - R2 = R4 (right side)

2. **Load distribution**: 
   - Loads closer to a corner should produce higher reactions at that corner
   - For a load on the left side: R1 and R3 should be higher than R2 and R4

3. **Total equilibrium**:
   - R1 + R2 + R3 + R4 = Total applied load (including casing weight, primary loads, and component loads)

### Area Method Verification:
The corner reactions use the area method:
- R1 = Load × (Area opposite to R1) / Total area
- Where "Area opposite" means the area of the frame that is diagonally opposite to the corner

For a load at position (x, y):
- R1 = Load × (L-x)(W-y) / (L×W)
- R2 = Load × (x)(W-y) / (L×W)
- R3 = Load × (L-x)(y) / (L×W)
- R4 = Load × (x)(y) / (L×W)

## 6. Quick Verification Tests

### Test 1: Single Point Load at Center
- Apply 1000 N at center of 2000 mm beam
- Expected: Symmetric shear force, maximum moment at center
- Check: M_max ≈ PL/4 = 500 N·m

### Test 2: Uniform Load
- Apply uniform load w = 1000 N/m over full length
- Expected: Parabolic moment, maximum at center
- Check: M_max ≈ wL²/8 = 500 N·m

### Test 3: Load at Quarter Point
- Apply load at L/4 from left support
- Expected: Higher reaction at left support (3P/4) than right (P/4)
- Check: Shear force jumps at load location

### Test 4: Baseframe with Off-Center Load
- Apply load on left side of frame
- Expected: R1 and R3 > R2 and R4
- Check: Sum of all reactions = total load

## 7. Common Issues to Watch For

1. **Units mismatch**: Ensure all units are consistent (mm, N, N·mm, etc.)
2. **Sign errors**: Check that positive/negative conventions are correct
3. **Integration errors**: Deflection should be the double integral of moment
4. **Boundary conditions**: Supports should have zero deflection and appropriate moment conditions
5. **Load application**: Ensure loads are applied at correct positions

## 8. Using External Tools for Verification

### Online Calculators:
- **BeamGuru.com**: Simple beam analysis
- **SkyCiv**: Free beam calculator
- **StructX**: Structural analysis tools

### Software:
- **ANSYS**: Finite element analysis
- **SolidWorks Simulation**: CAD-integrated FEA
- **Autodesk Robot Structural Analysis**: Professional structural analysis

### Manual Calculations:
- Use standard beam formulas from structural engineering textbooks
- Reference: "Roark's Formulas for Stress and Strain" or "AISC Steel Construction Manual"

## 9. Expected Relationships

1. **Shear → Moment**: M = ∫V dx (moment is integral of shear)
2. **Moment → Deflection**: δ = ∫∫(M/EI) dx (deflection is double integral of moment/EI)
3. **Load → Shear**: V = ∫w dx (shear is integral of load)
4. **Load → Moment**: M = ∫∫w dx (moment is double integral of load)

## 10. Red Flags

If you see these, there may be calculation errors:
- ❌ Shear force doesn't equal reactions at supports
- ❌ Bending moment not zero at simple supports
- ❌ Deflection not zero at supports
- ❌ Maximum moment not at zero shear location
- ❌ Corner reactions don't sum to total load
- ❌ Unrealistic deflection values (too large or too small)
- ❌ Discontinuities in smooth curves (for continuous loads)

## 11. Validation Checklist

Before trusting the results, verify:
- [ ] Force equilibrium: ΣF = 0
- [ ] Moment equilibrium: ΣM = 0
- [ ] Reactions match expected values
- [ ] Shear force diagram shape matches load distribution
- [ ] Bending moment maximum at zero shear
- [ ] Deflection reasonable for given loads and material
- [ ] Units are consistent throughout
- [ ] Boundary conditions correctly applied
- [ ] Load positions match input values
- [ ] Material properties (E, I) are correct

