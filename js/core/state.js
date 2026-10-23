

window.__spiroRegisterModule?.('js/core/state');
        const state = {
            layers: [],
            activeLayerId: null,
            layerIsolation: null,
            zoom: window.matchMedia('(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)').matches ? 0.9 : 1.0,
            panX: 0,
            panY: 0,
            isPanning: false,
            lastMousePos: { x: 0, y: 0 },
            bgColor: '#090d16',
            backgroundImageDataUrl: '',
            transparentDesktop: false,
            sceneBlend: { mode:'normal', strength:100, opacity:100 },
            showGrid: false,
            showRoundingGuides: false,
            roundingGuidesDashed: true,
            roundingGuideColor: '#94a3b8',
            roundingGuideOpacity: 28,
            showBoundingCircle: false,
            boundingCircleColor: '#94a3b8',
            showVignette: false,
            ambientOverPrism: false,
            uiVisibility: { showPresets: false, showProjects: true, hideMorphChooser: true, hideProfiles: true },
            sidebarMode: 'shape',
            ambient: {
                rain:{enabled:false,angle:14,density:70,color:'#a6c8ff',hue:0,opacity:55,speed:170},
                dichotomy:{enabled:false,count:2,offset:6,hue:0,opacity:30,colorA:'#ff4089',colorB:'#0ce4ff',colorC:'#ffe176'},
                rainbow:{enabled:false,offset:6,strength:40},
                reiatsu:{enabled:false,strength:25,speed:100},
                earthquake:{enabled:false,strength:25,speed:100},
                clouds:{enabled:false,density:42,color:'#acc5e7',hue:0,opacity:24,speed:12}
            },
            prism:{enabled:false,mode:'3d',source2d:'sprite',spriteDataUrl:'',shape:'sphere',size:260,refraction:16,dispersion:55,opacity:63,lightHue:192,lightIntensity:55,fillHue:194,fill:9,speed:15,positionX:0,positionY:0,tiltX:12,tiltY:0},
            motion: { rotationEnabled:false, rotationSpeed:30, rotationMultiplier:1, rotationDirection:'ccw', rotationTunnelLag:0, rotationTunnelLagMultiplier:1, cameraEnabled:false, cameraSpeed:20, cameraMultiplier:1, cameraAmount:20, colorEnabled:false, colorSpeed:20, colorMultiplier:1, paletteKey:'standard', quickToggleCamera:false, quickToggleColor:false },
            fourierMode: false,
            fourierStrength: 50,
            masterLayerEdit: false,
            sidebarFeatureToggleMemory: {},
            graffitiDefaultActive: false,
            // Artistic compositor order, bottom -> top. Technical passes inside the
            // geometry group keep their own invariant order.
            effectOrder: ['fill','web','geometry','lamps','sweep','pathfx','particles'],

            forceAllLinesHidden: false,
            geometryWebGL: true,
            showLines: true,
            showLamps: false,
            showWeb: false,
            lightningRateSync: true,
            sweep: { enabled: false, glintEnabled:false, lightningEnabled:false, effectType: 'lightning', profileShape:'current', coreBlendMode:'normal', glowBlendMode:'normal',  flashMode:'moving', flashType:'high', glintPrecision:'high', spectralSectorDegrees:45, spectralAngularSpeed:90, mode: 'perPath', direction: 'forward', speed: 0.25, speedMultiplier: 1, syncMusic: true, lengthPercent: 3, widthPercent: 75, everyN: 2, color: '#ffffff', opacity:100, brightness:100, glow:18, glowMultiplier:1, glowIntensity:100, glowIntensityMultiplier:1, softness:100, softnessMultiplier:1, lightningProfileShape:'current', lightningBehavior:'symmetric', lightningPrecision:'exact', lightningMode:'perPath', lightningEveryN:2, lightningRandomPosition:true, lightningColor:'#ffffff', lightningSecondaryColor:'#7dd3fc',  lightningSegmentPercent:100, lightningTriggerMode:'morph', lightningRatePercent:100, lightningRateMultiplier:1, lightningDurationMs:480, lightningWidthPercent:64, lightningBrightness:100, lightningGlow:16, lightningGlowMultiplier:1, lightningGlowIntensity:100, lightningGlowIntensityMultiplier:1, lightningSoftness:100, lightningSoftnessMultiplier:1, lightningSmoothLighting:true, lightningShowLines:true, lightningLineOpacity:100, lightningAfterglow:true, lightningAfterglowMs:280, lightningMicroStrikes:2, lightningPhase:0, lightningLastUpdate:0, lightningCycleCount:0, phase: 0, currentVelocity: 0, lastUpdate: 0, cycleCount:0, raf: 0 },
            web: { type:'bevel', style:'web', region:'inside', inside:true, outsideStraight:false, outsideArc:false, placementMode:'selfIntersection', oscillating:false, oscillationStrength:10, oscillationStrengthMultiplier:1, oscillationMultiplier:1, angleThreshold:60, width:0.6, widthRelative:false, widthPercent:40, color:'#ffffff', secondaryColor:'#00ffff', sunDegrees:20, distance:30, depthMultiplier:1, spacing:10, angleVariation:6 },
            lineOutline: { enabled: false, color: '#ffffff', width: 1.5, mode:'outer' },
            lamps: {
                positionMode: 'key',
                colorMode: 'line',
                matchLineColor: true,
                rainbow: false,
                color: '#ffe600',
                webgl: true,
                freezeLight: false,
                freezeTailSec: 1.5,
                freezeHardness: 50,
                freezeColorMode: 'lamp',
                freezeColor: '#00ffcc',
                freezeHueDegrees: 45,
                freezeChromatic: false,
                freezeChromaticColor: '#22d3ee',
                freezeRain: false,
                freezeRainDirectionVersion: 2,
                freezeRainDegrees: 180,
                freezeRainSource: 'core',
                freezeRainSpeed: 50,
                freezeRainTailSec: 1.5,
                freezeRainHardness: 50,
                brightness: 60,
                radius: 25,
                radiusMultiplier: 1,
                softness: 100,
                softnessMultiplier: 1,
                blendMode: 'lighter',
                type: 'whiteCore',
                density: 100,
                densityMultiplier: 1,
                scatter: 0,
                scatterMultiplier: 1,
                sizeVariation: 0,
                sizeVariationMultiplier: 1,
                brightnessVariation: 0,
                brightnessVariationMultiplier: 1,
                adaptiveBrightness: true,
                adaptiveAdjustBrightness: false,
                adaptiveStrength: 100,
                adaptiveStrengthMultiplier: 1,
                adaptiveFadeSec: 1,
                morphEnabled: false,
                morphSize: 20,
                morphBrightness: 25,
                morphMotionMode: 'linear',
                morphInertia: 50,
                cornerInertiaLinked: true,
                cornerInertiaPercent: 10,
                cornerInertiaSec: 0.5,
                calmMode: true,
                snapToContour: true,

                stickToRounding: true,
                snapToPolygon: true
            },
            randomLayerCount: 3,
            library: { shapes: [], morphs: [], defaultMorphId: null },
            projectFileHandle: null,
            projectFileName: '',
            draftProjectName: 'Проект один',
            playlistFileHandle: null,
            playlistFileName: '',
            playlistProjects: [],
            playlistCurrentProjectId: null,
            playlistMenuSettings: null,
            playlistBpm: 0,
            playlistTapTempo: { autoTap: false, autoWindowSec: 10, autoBand: 'low' },
            playlistDefaultSettings: null,
            playlistColorPalettes: null,
            playlistPaletteHueOffset: 0,
            activeProjectPaletteKey: 'standard',
            playlistOverridesActive: false,
            suppressPlaylistOverrideCapture: false,
            projectMorph: {
                active: false,
                intervalSec: 16,
                syncTap: true,
                beatsPerProject: 32,
                transitionBeats: 8,
                cameraWander: false,
                transitionType: 'smooth',
                advancedLinear: false,
                transitionSec: 4,
                imageTransitionType: 'fade',
                imageCenterSoftness: 24,
                imageSectorSoftness: 18,
                fadeProgress: 0,
                sourceProject: null,
                targetProject: null,
                sourceIndex: -1,
                targetIndex: -1,
                startAt: 0,
                durationMs: 16000
            },
            tunnel: {
                active: false,
                defaultActive: false,
                raf: 0,
                phase: 0,
                travelPhase: 0,
                lastTime: 0,
                speed: 0.42,
                speedStrength: 1,
                signedSpeedVersion: 1,
                speedMultiplier: 1,
                spacingStrength: 3,
                spacingMultiplier: 1,
                depthCurve: 0,
                depthCurveMultiplier: 1,
                centerHiddenCopies: 2,
                colorShiftEnabled: false,
                colorShiftDegrees: 30,
                colorShiftCumulative: false,
                paletteLagEnabled: false,
                direction: 'toward',
                fadeOversize: true,
                fadeOffsetSteps: 3,
                vignetteAmount: 54, vignetteMultiplier: 1,
                vignetteUnit: 'px',
                fadeDurationSec: 3,
                optimizedCalculation: true,
                copies: 16,
                minScale: 0.055,
                maxScale: 3.8
            },
            tapTempo: {
                bpm: 0,
                beatsPerMorph: 16,
                autoTap: false,
                autoWindowSec: 10,
                autoBand: 'low',
                tapTimes: [],
                anchorTime: 0,
                lastTapAt: 0,
                lastAppliedBpm: 0,
                autoPrevSpectrum: null,
                autoFluxHistory: [],
                autoBeatTimes: [],
                autoLastPeakAt: 0,
                autoConfidence: 0,
                autoTempoCandidate: 0,
                autoTempoCandidateCount: 0,
                autoTempoEvidence: [], autoTempoLastApplyAt: 0,
                autoFluxPrevSample: null,
                autoFluxPrevPrevSample: null,
                autoBandTrackers: {},
                autoChosenBand: '',
                autoBandLastDecisionAt: 0,
                autoTempoLock: null, autoLastDecisionPeakAt: 0,
                syncFullMorph: false,
                syncMinimalMorph: false
            },
            audioReactive: {
                active: false,
                source: 'system',
                context: null,
                analyser: null,
                stream: null,
                data: null,
                timeData: null,
                raf: 0,
                noiseGateEnabled: false,
                noiseGateThresholdDb: -37,
                noiseGateSoftEnabled: false,
                noiseGateStrength: 0,
                inputDb: -100,
                gateOpen: true,
                gateGain: 1,
                gateListening: false,
                gateListenStartedAt: 0,
                gateListenDurationMs: 2000,
                gateListenSamples: [],
                highPassHz: 20,
                lowHz: 120,
                highHz: 5000,
                bandCount: 3,
                customBandsEnabled: false,
                masterBandEdges: [120, 5000],
                customBandRanges: { low:[20,120], lowMid:[120,500], mid:[500,2000], midHigh:[2000,5000], high:[5000,20000] },
                bandGains: { low:1, lowMid:1, mid:1, midHigh:1, high:1 },
                defaultRoutesEnabled: true,
                lowPassHz: 20000,
                levels: [0, 0, 0, 0, 0],
                smoothedLevels: [0, 0, 0, 0, 0],
                prevLevels: [0, 0, 0, 0, 0],
                derivatives: [0, 0, 0, 0, 0],
                normalizationWindowMs: 10000,
                lowSignalWindowMs: 5000,
                levelHistory: [],
                normalizationPeak: 0,
                normalizationFloor: 0,
                normalizeLowSignal: false,
                inputSmoothingEnabled: false,
                inputSmoothingStrength: 50,
                inputSmoothingMultiplier: 1,
                masterGainStrength: 50,
                masterGainMultiplier: 1,
                effectsAmplitudeStrength: 50,
                effectsAmplitudeMultiplier: 1,
                sizeStrength: 1,
                sizeMultiplier: 1,
                rotationEnabled: false,
                rotationStrength: 0.3,
                rotationMultiplier: 0.1,
                referenceRadius: 220,
                analysisIntervalMs: 40,
                meterIntervalMs: 40,
                lastAnalysisTime: 0,
                lastMeterPaint: 0,
                routingInitialized: false,
                routingTarget: 'master',
                routingPreset: 'geometryLamps',
                masterEditEnabled: false,
                masterRouteMultipliers: {},
                groupToggleMemory: {},
                layerSignalEnabled: {},
                routes: { master: [], layers: {} }
            },
            minimalMorph: {
                profiles: [],
                activeProfileId: 'orange-standard',
                active: false,
                mode: 'standard',
                family: 'mix',
                profileGroups: ['standard'],
                generatorStyle: 'standard',
                routingBindings: [],
                featureOverrides: {},
                defaultActive: false,
                autoStartedByProject: false,
                paused: false,
                pauseStartedAt: 0,
                originLayers: [],
                originActiveLayerId: null,
                originPresetValue: '', 
                transitioning: false,
                intervalSec: 5,
                fadeSec: 0.1,
                instantSwitch: true,
                nextSwitchAt: 0,
                fadeStart: 0,
                progress: 0,
                raf: 0,
                sourceLayers: [],
                targetLayers: [],
                sourceDrawData: [],
                targetDrawData: [],

                sourceLampPoints: [],
                targetLampPoints: []
            },
            morphPlayback: {
                lastType: null
            },
            randomOptions: {
                byShape: true,
                onlyLine: false,
                byVertices: true,
                bySteps: true,
                byRounding: true,
                bySize: true,
                byColor: true,
                lineColorPalette: 'standard',
                fillHarmony: 'native',
                fillLayersMin: 0,
                fillLayersMax: 1,
                orbitCount: 0,
                orbitBindingEnabled: true,
                orbitPercentMin: 100,
                orbitPercentMax: 100,
                cyclePalettes: false,
                fixedColors: false,
                bySpiralLayers: false,
                spiralLayersMin: 0,
                spiralLayersMax: 1
            },
            morph: {
                profiles: [],
                activeProfileId: 'standard',
                active: false,
                defaultActive: false,
                autoStartedByProject: false,
                paused: false,
                pausedByOrangeProject: false,
                pauseStartedAt: 0,
                pauseOnSpace: false,
                originLayers: [],
                originActiveLayerId: null,
                originPresetValue: '',
                intervalSec: 5,
                intervalMultiplier: 1,
                diversity: false,
                featureOverrides: {},
                vertexMin: 4,
                vertexMax: 19,
                vertexMultiplier: 1,
                roundingMin: 0,
                roundingMax: 30,
                stepMin: 0,
                stepMax: 100,
                monoOrbitTransforms: true,
                orbitPercentMin: 0,
                orbitPercentMax: 0,
                strokeWidthMin: 0.8,
                strokeWidthMax: 3.2,
                opacityMin: 70,
                opacityMax: 100,
                speedType: 'linear',
                progress: 0,
                cycleStart: 0,

                exactStartPending: false,
                transitionMs: 5000,
                sourceProfiles: [],
                targetProfiles: [],
                sourceVisuals: [],
                targetVisuals: [],
                sourceGeometry: [],
                targetGeometry: [],
                geometryBlend: 0,
                lightScales: [],
                lightRotations: [],
                lightLayers: [],
                lightDrawData: [],
                lightGeometryBucket: -1,
                runtimeProfiles: [],
                renderSourceLayers: [],
                renderTargetLayers: [],
                lastFrameUpdate: 0,
                sourceColorHsl: [],
                targetColorHsl: [],
                sourceFillColorHsl: [],
                targetFillColorHsl: [],
                sourceFillIndices: [],
                fillLayersMin: 0,
                fillLayersMax: 1,
                fillHueMin: -15,
                fillHueMax: 15,
                fillHueReset: true,
                fillHueHarmony: 'native',
                lineColorPalette: 'standard',
                cyclePalettes: false,
                fixedColors: false,
                syncPalettesBetweenMorphs: true,
                morphGlobalHueOffset: false,
                globalHueOffsetRange: 180,
                sizeVariation: 100,
                sizeVariationMultiplier: 1,
                radiusMin: 20,
                radiusMax: 500,
                normalizeSizes: true,
                rotationMinPercent: 0,
                rotationMaxPercent: 50,
                rotationMultiplier: 1,
                rotationRandomDirection: true,
                fillOpacityMin: 3,
                fillOpacityMax: 3,
                mode: 'circleSlide',
                fadePercent: 0,
                circleProfileOverflow: true,
                slideType: 'sector',
                lightningWhite: true,
                lightningRandom: false,
                lightningColor: '#ffffff',
                lightningCycleColor: '#ffffff',
                lightningSegmentPercent: 30,
                lightningGlow: 18,
                lastEditorPaint: 0,
                lastSidebarPaint: 0,
                manualProfileEditing: false,
                splinePoints: 12,
                profileModeTransition: 'phase',
                profileModeTransitionPercent: 20,
                spiralOrderMin: -1,
                spiralOrderMax: 1,
                spiralOrderLinked: false,
                spiralLayersMin: 0,
                spiralLayersMax: 1,
                chaosMorphEnabled: false,
                chaosMorphStepSpread: 1,
                chaosMorphClosuresMax: 3,
                preserveSpiralContinuity: true,
                spiralMorphType: 'phaseCircle',
                spiralRotationCompensation: false,
                options: {
                    byShape: true,
                    byVertices: true,
                    bySteps: true,
                    byRounding: false,
                    byStrokeWidth: true,
                    bySize: true,
                    byColor: true,
                    byFillColor: true,
                    byOpacity: false,
                    byRotation: true,
                    bySpiralOrder: false,
                    bySpiralLayers: false
                },
                shapeOptions: {
                    noLoops: true,
                    loops: false,
                    closed: false,
                    open: false,
                    family: 'mix',
                    profileGroups: ['standard'],
                    profileGroup: 'all',
                    standardOnly: false
                }
            }
        };

        const runtimeState = {
            interaction: {},
            fileSession: {},
            projectMorph: {},
            tunnel: {},
            tapTempo: {},
            audioReactive: {},
            minimalMorph: {},
            morphPlayback: {},
            morph: {}
        };

        const STATE_RUNTIME_FIELDS = Object.freeze({
            projectMorph: [
                'active','fadeProgress','sourceProject','targetProject','sourceIndex','targetIndex',
                'startAt','durationMs','geometryPlans','frameGeometry','frameExtents','sourceGeometry',
                'targetGeometry','sourceRenderLayers','targetRenderLayers','lampPlans','frameLampPoints',
                'endpointPending','progress','renderProgress','parameterProgress','transitionProgress','renderMode',
                'frameGeometryProgress','frameGeometryLayerProgress','frameRenderLayers','frameMorphSettings','frameTunnelSettings','frameLampConfig','crossfadeConfigSide','lastSettingsUiAt','lockedCamera','backgroundActive','transitionActive','sourceCaptured','restoreProject'
            ],
            tunnel: ['active','raf','phase','travelPhase','lastTime'],
            tapTempo: [
                'tapTimes','anchorTime','lastTapAt','lastAppliedBpm','autoPrevSpectrum','autoFluxHistory',
                'autoBeatTimes','autoLastPeakAt','autoConfidence','autoTempoCandidate',
                'autoTempoCandidateCount','autoFluxPrevSample','autoFluxPrevPrevSample',
                'autoBandTrackers','autoChosenBand','autoBandLastDecisionAt',
                'autoTempoLock','autoLastDecisionPeakAt'
            ],
            audioReactive: [
                'active','context','analyser','stream','data','timeData','raf','inputDb','gateOpen','gateGain',
                'gateListening','gateListenStartedAt','gateListenDurationMs','gateListenSamples','levels',
                'smoothedLevels','prevLevels','derivatives','levelHistory','normalizationPeak',
                'normalizationFloor','lastAnalysisTime','lastMeterPaint'
            ],
            minimalMorph: [
                'active','autoStartedByProject','paused','pauseStartedAt','originLayers','originActiveLayerId',
                'originPresetValue','transitioning','nextSwitchAt','fadeStart','progress','raf','sourceLayers',
                'targetLayers','sourceDrawData','targetDrawData','sourceLampPoints','targetLampPoints','webUiHoldStart'
            ],
            morphPlayback: ['lastType'],
            morph: [
                'active','autoStartedByProject','paused','pausedByOrangeProject','pauseStartedAt','originLayers',
                'originActiveLayerId','originPresetValue','originGlobalHueOffset','progress','cycleStart','exactStartPending','transitionMs',
                'sourceProfiles','targetProfiles','sourceVisuals','targetVisuals','sourceGeometry','targetGeometry',
                'geometryBlend','geometryT','lightScales','lightRotations','lightLayers','lightDrawData',
                'lightGeometryBucket','runtimeProfiles','renderSourceLayers','renderTargetLayers','lastFrameUpdate',
                'sourceColorHsl','targetColorHsl','sourceFillColorHsl','targetFillColorHsl','sourceFillIndices',
                'lightningCycleColor','lastEditorPaint','lastSidebarPaint','manualProfileEditing','webUiHoldStart',
                'boundaryPaintPending','lampCycleSerial','suppressPaletteCycleOnce','sourceGlobalHueOffset','targetGlobalHueOffset','frameGlobalHueOffset','frameLayers','phaseSerial','phaseReason','pausedByGreenProject','_sourceGeometryPool',
                '_targetGeometryPool','profileCarrierPlans','gpuPhaseWarming','gpuPhaseWarmSerial','gpuSpecializedSpiralReady','parameterRouting'
            ]
        });

        const STATE_RUNTIME_DEFAULTS = Object.freeze({
            projectMorph: {
                active:false, fadeProgress:0, sourceProject:null, targetProject:null, sourceIndex:-1, targetIndex:-1,
                startAt:0, durationMs:16000, geometryPlans:[], frameGeometry:[], frameExtents:[], sourceGeometry:[],
                targetGeometry:[], sourceRenderLayers:[], targetRenderLayers:[], lampPlans:[], frameLampPoints:[],
                endpointPending:false, progress:0, renderProgress:0, parameterProgress:0, transitionProgress:0, renderMode:'morph',
                frameGeometryProgress:-1, frameGeometryLayerProgress:[], frameRenderLayers:[], frameMorphSettings:null, frameTunnelSettings:null, frameLampConfig:null, crossfadeConfigSide:null, lastSettingsUiAt:0, lockedCamera:null, backgroundActive:false, transitionActive:false, sourceCaptured:false, restoreProject:null
            },
            tunnel: { active:false, raf:0, phase:0, travelPhase:0, lastTime:0 },
            tapTempo: {
                tapTimes:[], anchorTime:0, lastTapAt:0, lastAppliedBpm:0, autoPrevSpectrum:null,
                autoFluxHistory:[], autoBeatTimes:[], autoLastPeakAt:0, autoConfidence:0, autoTempoCandidate:0,
                autoTempoCandidateCount:0, autoTempoEvidence:[], autoTempoLastApplyAt:0, autoFluxPrevSample:null, autoFluxPrevPrevSample:null,
                autoBandTrackers:{}, autoChosenBand:'', autoBandLastDecisionAt:0,
                autoTempoLock:null, autoLastDecisionPeakAt:0
            },
            audioReactive: {
                active:false, context:null, analyser:null, stream:null, data:null, timeData:null, raf:0, inputDb:-100,
                gateOpen:true, gateGain:1, gateListening:false, gateListenStartedAt:0, gateListenDurationMs:2000,
                gateListenSamples:[], levels:[0,0,0,0,0], smoothedLevels:[0,0,0,0,0], prevLevels:[0,0,0,0,0],
                derivatives:[0,0,0,0,0], levelHistory:[], normalizationPeak:0, normalizationFloor:0,
                lastAnalysisTime:0, lastMeterPaint:0
            },
            minimalMorph: {
                active:false, autoStartedByProject:false, paused:false, pauseStartedAt:0, originLayers:[],
                originActiveLayerId:null, originPresetValue:'', transitioning:false, nextSwitchAt:0, fadeStart:0,
                progress:0, raf:0, sourceLayers:[], targetLayers:[], sourceDrawData:[], targetDrawData:[],
                sourceLampPoints:[], targetLampPoints:[], webUiHoldStart:0
            },
            morphPlayback: { lastType:null },
            morph: {
                active:false, autoStartedByProject:false, paused:false, pausedByOrangeProject:false,
                pauseStartedAt:0, originLayers:[], originActiveLayerId:null, originPresetValue:'', originGlobalHueOffset:0, progress:0,
                cycleStart:0, exactStartPending:false, transitionMs:5000, sourceProfiles:[], targetProfiles:[],
                sourceVisuals:[], targetVisuals:[], sourceGeometry:[], targetGeometry:[], geometryBlend:0,
                geometryT:0, lightScales:[], lightRotations:[], lightLayers:[], lightDrawData:[],
                lightGeometryBucket:-1, runtimeProfiles:[], renderSourceLayers:[], renderTargetLayers:[],
                lastFrameUpdate:0, sourceColorHsl:[], targetColorHsl:[], sourceFillColorHsl:[],
                targetFillColorHsl:[], sourceFillIndices:[], lightningCycleColor:'#ffffff', lastEditorPaint:0,
                lastSidebarPaint:0, manualProfileEditing:false, webUiHoldStart:0, boundaryPaintPending:false,
                lampCycleSerial:0, suppressPaletteCycleOnce:false, sourceGlobalHueOffset:0, targetGlobalHueOffset:0, frameGlobalHueOffset:0, frameLayers:[], phaseSerial:0, phaseReason:'init', pausedByGreenProject:false, _sourceGeometryPool:[], _targetGeometryPool:[], profileCarrierPlans:[], gpuPhaseWarming:false, gpuPhaseWarmSerial:0, gpuSpecializedSpiralReady:false, parameterRouting:null
            }
        });

        function cloneRuntimeDefault(value) {
            if (Array.isArray(value)) return value.map(cloneRuntimeDefault);
            if (value && typeof value === 'object') {
                const out = {};
                for (const [key, item] of Object.entries(value)) out[key] = cloneRuntimeDefault(item);
                return out;
            }
            return value;
        }

        const RUNTIME_ACCESSOR_SECTIONS = new Set(['tunnel','tapTempo','audioReactive','morphPlayback']);

        function migrateRuntimeFields(sectionName, compatAccessor = false) {
            const section = state[sectionName];
            const bucket = runtimeState[sectionName] || (runtimeState[sectionName] = {});
            const defaults = STATE_RUNTIME_DEFAULTS[sectionName] || {};
            if (!section || typeof section !== 'object') return;
            for (const key of STATE_RUNTIME_FIELDS[sectionName] || []) {
                const descriptor = Object.getOwnPropertyDescriptor(section, key);
                if (descriptor?.get && descriptor?.set) {
                    if (!Object.prototype.hasOwnProperty.call(bucket, key)) bucket[key] = section[key];
                    delete section[key];
                } else if (Object.prototype.hasOwnProperty.call(section, key)) {
                    bucket[key] = section[key];
                    delete section[key];
                } else if (!Object.prototype.hasOwnProperty.call(bucket, key)) {
                    bucket[key] = cloneRuntimeDefault(defaults[key]);
                }
                if (compatAccessor) {
                    Object.defineProperty(section, key, {
                        configurable: true,
                        enumerable: false,
                        get() { return bucket[key]; },
                        set(value) { bucket[key] = value; }
                    });
                }
            }
        }

        function bindTopLevelRuntimeField(key, bucketName, defaultValue) {
            const bucket = runtimeState[bucketName] || (runtimeState[bucketName] = {});
            if (Object.prototype.hasOwnProperty.call(state, key)) {
                bucket[key] = state[key];
                delete state[key];
            } else if (!Object.prototype.hasOwnProperty.call(bucket, key)) {
                bucket[key] = cloneRuntimeDefault(defaultValue);
            }
            Object.defineProperty(state, key, {
                configurable: true,
                enumerable: false,
                get() { return bucket[key]; },
                set(value) { bucket[key] = value; }
            });
        }

        function replaceRuntimeBoundSection(sectionName, nextValue) {
            const section = state[sectionName];
            if (!section || typeof section !== 'object') return section;
            const runtimeKeys = new Set(STATE_RUNTIME_FIELDS[sectionName] || []);
            const incoming = nextValue && typeof nextValue === 'object' ? nextValue : {};

            for (const key of Object.keys(section)) delete section[key];
            for (const [key, value] of Object.entries(incoming)) {
                if (runtimeKeys.has(key)) runtimeState[sectionName][key] = value;
                else section[key] = value;
            }
            migrateRuntimeFields(sectionName, RUNTIME_ACCESSOR_SECTIONS.has(sectionName));
            return section;
        }

        for (const sectionName of Object.keys(STATE_RUNTIME_FIELDS)) {
            migrateRuntimeFields(sectionName, RUNTIME_ACCESSOR_SECTIONS.has(sectionName));
        }
        bindTopLevelRuntimeField('isPanning', 'interaction', false);
        bindTopLevelRuntimeField('lastMousePos', 'interaction', {x:0,y:0});
        bindTopLevelRuntimeField('projectFileHandle', 'fileSession', null);
        bindTopLevelRuntimeField('projectFileName', 'fileSession', '');
        bindTopLevelRuntimeField('playlistFileHandle', 'fileSession', null);
        bindTopLevelRuntimeField('playlistFileName', 'fileSession', '');
        bindTopLevelRuntimeField('suppressPlaylistOverrideCapture', 'fileSession', false);

        function getPersistentStateBoundarySnapshot() {
            const result = {};
            for (const sectionName of Object.keys(STATE_RUNTIME_FIELDS)) {
                const section = state[sectionName];
                result[sectionName] = {
                    configKeys: section && typeof section === 'object' ? Object.keys(section) : [],
                    runtimeKeys: Object.keys(runtimeState[sectionName] || {}),
                    runtimeEnumerableInState: (STATE_RUNTIME_FIELDS[sectionName] || []).filter(key =>
                        Object.prototype.propertyIsEnumerable.call(section || {}, key)
                    ),
                    compatibilityAccessors: (STATE_RUNTIME_FIELDS[sectionName] || []).filter(key => {
                        const d = Object.getOwnPropertyDescriptor(section || {}, key);
                        return Boolean(d?.get && d?.set);
                    }),
                    directRuntimeOnly: !RUNTIME_ACCESSOR_SECTIONS.has(sectionName)
                };
            }
            return result;
        }
        window.__spiroRuntimeState = runtimeState;

        window.__spiroMorphStateIsolationSnapshot = () => ({
            morph: { runtimeOnly: !RUNTIME_ACCESSOR_SECTIONS.has('morph'), configHasRuntimeKeys: (STATE_RUNTIME_FIELDS.morph||[]).filter(k => Object.prototype.hasOwnProperty.call(state.morph||{},k)) },
            minimalMorph: { runtimeOnly: !RUNTIME_ACCESSOR_SECTIONS.has('minimalMorph'), configHasRuntimeKeys: (STATE_RUNTIME_FIELDS.minimalMorph||[]).filter(k => Object.prototype.hasOwnProperty.call(state.minimalMorph||{},k)) },
            projectMorph: { runtimeOnly: !RUNTIME_ACCESSOR_SECTIONS.has('projectMorph'), configHasRuntimeKeys: (STATE_RUNTIME_FIELDS.projectMorph||[]).filter(k => Object.prototype.hasOwnProperty.call(state.projectMorph||{},k)) },
            remainingAccessorSections: Array.from(RUNTIME_ACCESSOR_SECTIONS)
        });
        window.__spiroStateBoundarySnapshot = getPersistentStateBoundarySnapshot;
        window.__spiroDirectRuntimePathSnapshot = () => ({
            blue: {
                active: runtimeState.morph.active === true,
                progress: Number(runtimeState.morph.progress) || 0,
                geometryT: Number(runtimeState.morph.geometryT) || 0,
                sourceGeometry: runtimeState.morph.sourceGeometry?.length || 0,
                targetGeometry: runtimeState.morph.targetGeometry?.length || 0
            },
            orange: {
                active: runtimeState.minimalMorph.active === true,
                transitioning: runtimeState.minimalMorph.transitioning === true,
                progress: Number(runtimeState.minimalMorph.progress) || 0,
                sourceLayers: runtimeState.minimalMorph.sourceLayers?.length || 0,
                targetLayers: runtimeState.minimalMorph.targetLayers?.length || 0
            },
            green: {
                active: runtimeState.projectMorph.active === true,
                progress: Number(runtimeState.projectMorph.progress) || 0,
                fadeProgress: Number(runtimeState.projectMorph.fadeProgress) || 0,
                frameGeometry: runtimeState.projectMorph.frameGeometry?.length || 0,
                endpointPending: runtimeState.projectMorph.endpointPending === true
            },
            providerReadsSplitConfigRuntime: true
        });

