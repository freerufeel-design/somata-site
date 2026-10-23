# Somata 8.20.11 — Crystal material / sphere / sculpted skull / controls

Baseline: **8.20.10**. This is a targeted update; shared FrameContour, Corridor, Blue/Orange/Green Morph and the independent WebGPU overlay are not replaced.

## Changes

1. **Sphere** — denser smooth UV mesh (64×128, 16,384 triangles). Replaced axis-wise rectangular clamping of the refracted pixel offset with a continuous isotropic radial falloff to remove the square refraction artifact within the sphere. Other mesh types retain their previous optical mode. This is still an approximation to a refractive material, not full ray tracing.
2. **Crystal light and fill** — separate light hue, light intensity, body-fill hue, body-fill intensity. They are independent from the existing refraction, dispersion and transparency controls and are submitted to the active WebGPU shader as a fourth `vec4<f32>` uniform (128 bytes total). The fallback WebGPU material also responds to these values.
3. **Skull** — replaced near-spherical outline with a sculpted closed surface: broad cranium, temples, concave eye sockets, cheekbones, nose bridge, narrowing mandible and teeth detail. It remains a stylized procedural skull, not an imported anatomical asset.
4. **UI** — all 29 primary numeric controls in the ambient/crystal panels now use the established Lamp-style stacked value-and-control layout. Multipliers are editable numbers with logarithmic handling (`data-log-multiplier`), initial ×1 and protected range ×0.125…×8; no discrete dropdowns remain. Hue controls have their own log multipliers.
5. **Shape selection** — previous/next buttons on either side of the shape list, wrapping across the six built-in shapes. Both trigger the existing `change` pathway rather than introducing an independent setter.
6. **Routing** — `prism.lightHue`, `.lightIntensity`, `.fillHue`, `.fill` and all four multiplier controls are registered in the shared parameter Registry/Matrix and exposed to the compatible Morph/Audio route lists. Base authored values remain separated from their multipliers.

## Regression coverage

- `tests/v8211-crystal-controls-sphere-skull-regression.js`: dense meshes/finite geometry, shader change protecting circular distortion, GPU uniform bindings, Registry/Matrix routes, Lamp-style multipliers, arrow callbacks.
- `tests/v8211-real-crystal-ui-regression.js`: Chromium DOM interaction, actual click/change on both arrows, live hue/fill changes, route parity, state isolation.
- `tests/v8207-optical-webgpu-glass-regression.js`: extended to verify that all four new controls reach **GPU buffer indices 28–31**, including later edits.
- Updated the historic 8.20.4 multiplier regression to test the *new* numeric/log layout and all 29 routed controls. Its functional assertions for routing, ×4 render impact, right-click and Corridor are preserved.
- Existing static integrity, 8.20.3–8.20.9 optical tests and 7.11.12 shared matrix parity are retained.

### Limitations

Final WebGPU WGSL pixel output on an NVIDIA device was not available for verification in this environment. A valid WebGPU command and Chromium UI test are not a substitute for a screenshot with refraction and lighting changed side by side. FPS numbers before and after are not claimed. GPU shader recompilation after source changes may vary with drivers; report any diagnostic message from the 3D panel.
