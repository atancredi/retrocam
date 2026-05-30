import { useEffect, useRef, useState, useCallback } from 'react';

type CameraMode = 'environment' | 'user';
type FilterMode = 'custom' | 'crunch' | 'gameboy' | 'grayscale' | 'sepia' | 'cyberpunk';

interface CustomSettings {
  rMulti: number;
  gMulti: number;
  bMulti: number;
  contrast: number;
  tintColor: string;
  tintStrength: number;
}

const hexToRgb = (hex: string) => {
  const bigint = parseInt(hex.slice(1), 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [facingMode, setFacingMode] = useState<CameraMode>('environment');
  const [activeMode, setActiveMode] = useState<FilterMode>('custom');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const [customSettings, setCustomSettings] = useState<CustomSettings>({
    rMulti: 1.0, gMulti: 1.0, bMulti: 1.0,
    contrast: 1.0, tintColor: '#ff0055', tintStrength: 0.0
  });

  const modeRef = useRef<FilterMode>(activeMode);
  const settingsRef = useRef<CustomSettings>(customSettings);
  const facingModeRef = useRef<CameraMode>(facingMode);

  const changeMode = (mode: FilterMode) => {
    setActiveMode(mode);
    modeRef.current = mode;
  };

  const updateSetting = (key: keyof CustomSettings, value: string | number) => {
    const parsedValue = typeof value === 'string' ? parseFloat(value) || value : value;
    const newSettings = { ...customSettings, [key]: parsedValue } as CustomSettings;
    setCustomSettings(newSettings);
    settingsRef.current = newSettings;
    changeMode('custom');
  };

  const toggleCamera = () => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newMode);
    facingModeRef.current = newMode;
    startCamera(newMode);
  };

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  const startCamera = async (mode: CameraMode) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: mode },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
    } catch (err) {
      console.error("Camera access denied or unavailable", err);
    }
  };

  const processFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !offscreenCanvasRef.current) return;
    
    if (videoRef.current.readyState !== videoRef.current.HAVE_ENOUGH_DATA) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const offCtx = offscreenCanvasRef.current.getContext('2d', { willReadFrequently: true });
    if (!ctx || !offCtx) return;

    const screenW = canvas.clientWidth;
    const screenH = canvas.clientHeight;
    if (screenW === 0 || screenH === 0) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const screenRatio = screenW / screenH;
    const totalPixels = 30000;
    const tinyH = Math.round(Math.sqrt(totalPixels / screenRatio));
    const tinyW = Math.round(tinyH * screenRatio);

    if (offscreenCanvasRef.current.width !== tinyW) {
      offscreenCanvasRef.current.width = tinyW;
      offscreenCanvasRef.current.height = tinyH;
    }

    const vWidth = videoRef.current.videoWidth;
    const vHeight = videoRef.current.videoHeight;
    if (vWidth === 0 || vHeight === 0) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const vRatio = vWidth / vHeight;
    let cropWidth = vWidth;
    let cropHeight = vHeight;
    let cropX = 0;
    let cropY = 0;

    if (vRatio > screenRatio) {
      cropWidth = vHeight * screenRatio;
      cropX = (vWidth - cropWidth) / 2;
    } else {
      cropHeight = vWidth / screenRatio;
      cropY = (vHeight - cropHeight) / 2;
    }

    if (facingModeRef.current === 'user') {
      offCtx.translate(tinyW, 0);
      offCtx.scale(-1, 1);
      offCtx.drawImage(videoRef.current, cropX, cropY, cropWidth, cropHeight, 0, 0, tinyW, tinyH);
      offCtx.setTransform(1, 0, 0, 1, 0, 0); 
    } else {
      offCtx.drawImage(videoRef.current, cropX, cropY, cropWidth, cropHeight, 0, 0, tinyW, tinyH);
    }

    const imageData = offCtx.getImageData(0, 0, tinyW, tinyH);
    const data = imageData.data;
    const mode = modeRef.current;
    const settings = settingsRef.current;
    const tintRgb = hexToRgb(settings.tintColor);

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i]; 
      let g = data[i + 1]; 
      let b = data[i + 2];

      switch (mode) {
        case 'custom': {
          r *= settings.rMulti; g *= settings.gMulti; b *= settings.bMulti;
          if (settings.tintStrength > 0) {
            r = (r * (1 - settings.tintStrength)) + (tintRgb.r * settings.tintStrength);
            g = (g * (1 - settings.tintStrength)) + (tintRgb.g * settings.tintStrength);
            b = (b * (1 - settings.tintStrength)) + (tintRgb.b * settings.tintStrength);
          }
          const factor = (259 * (settings.contrast * 100 + 255)) / (255 * (259 - settings.contrast * 100));
          r = factor * (r - 128) + 128; g = factor * (g - 128) + 128; b = factor * (b - 128) + 128;
          break;
        }
        case 'crunch': {
          r = r > 128 ? 255 : 0; g = g > 128 ? 255 : 0; b = b > 128 ? 255 : 0;
          break;
        }
        case 'gameboy': {
          const avg = (r + g + b) / 3; r = 15; g = avg + 50; b = 15;
          break;
        }
        case 'grayscale': {
          const avg = r * 0.3 + g * 0.59 + b * 0.11; r = avg; g = avg; b = avg;
          break;
        }
        case 'sepia': {
          const tr = (r * 0.393) + (g * 0.769) + (b * 0.189);
          const tg = (r * 0.349) + (g * 0.686) + (b * 0.168);
          const tb = (r * 0.272) + (g * 0.534) + (b * 0.131);
          r = tr; g = tg; b = tb;
          break;
        }
        case 'cyberpunk': {
          r = r * 1.5; g = g * 0.5; b = b * 1.5;
          r = r > 150 ? 255 : r; b = b > 150 ? 255 : b;
          break;
        }
      }

      data[i] = Math.min(255, Math.max(0, Math.floor(r / 64) * 64));
      data[i + 1] = Math.min(255, Math.max(0, Math.floor(g / 64) * 64));
      data[i + 2] = Math.min(255, Math.max(0, Math.floor(b / 64) * 64));
    }
    offCtx.putImageData(imageData, 0, 0);

    canvas.width = screenW;
    canvas.height = screenH;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offscreenCanvasRef.current, 0, 0, tinyW, tinyH, 0, 0, canvas.width, canvas.height);

    requestRef.current = requestAnimationFrame(processFrame);
  }, []);

  useEffect(() => {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 200; offCanvas.height = 150;
    offscreenCanvasRef.current = offCanvas;

    startCamera('environment');
    requestRef.current = requestAnimationFrame(processFrame);

    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
      cancelAnimationFrame(requestRef.current);
    };
  }, [processFrame]);

  const takePhoto = () => {
    if (!canvasRef.current) return;
    const fileName = `0-03MP-${Date.now()}.jpg`;
    const dataURL = canvasRef.current.toDataURL('image/jpeg', 0.9);
    const link = document.createElement('a');
    link.download = fileName;
    link.href = dataURL;
    link.click();

    setToastMessage(`Saved ${fileName} to device`);
    setTimeout(() => setToastMessage(null), 3000);
  };

  return (
    <div className="relative w-screen h-[100dvh] bg-black overflow-hidden font-mono text-white select-none">
      <video ref={videoRef} playsInline muted className="hidden" />

      <canvas 
        ref={canvasRef} 
        className="absolute inset-0 w-full h-full object-cover z-0"
        style={{ imageRendering: 'pixelated' }}
      />

      <div className="absolute bottom-0 w-full flex flex-col transition-transform duration-300 ease-in-out z-20">
        {isMenuOpen && (
          <div className="bg-black/80 backdrop-blur-md px-4 pt-2 pb-6 border-t border-red-500/30" style={{ maxHeight: '60dvh', overflowY: 'auto' }}>
            <div className="space-y-4">
              <div className="space-y-4">
                <div className="flex justify-between items-center text-xs text-gray-300">
                  <span>Tint Color</span>
                  <input type="color" value={customSettings.tintColor} onChange={(e) => updateSetting('tintColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
                </div>
                
                <div className="flex items-center gap-4 text-xs text-gray-300">
                  <span className="w-16">Intensity</span>
                  <input type="range" min="0" max="1" step="0.05" value={customSettings.tintStrength} onChange={(e) => updateSetting('tintStrength', e.target.value)} className="flex-1 h-2 bg-neutral-700 rounded-full appearance-none accent-white" />
                </div>

                <div className="flex items-center gap-4 text-xs text-gray-300">
                  <span className="w-16">Contrast</span>
                  <input type="range" min="0" max="3" step="0.1" value={customSettings.contrast} onChange={(e) => updateSetting('contrast', e.target.value)} className="flex-1 h-2 bg-neutral-700 rounded-full appearance-none accent-white" />
                </div>

                <div className="flex gap-4 pt-2">
                  <div className="flex-1 flex flex-col gap-2">
                    <span className="text-[10px] text-gray-400 text-center tracking-wider">RED</span>
                    <input type="range" min="0" max="2" step="0.1" value={customSettings.rMulti} onChange={(e) => updateSetting('rMulti', e.target.value)} className="w-full h-2 bg-neutral-700 rounded-full appearance-none accent-gray-300" />
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <span className="text-[10px] text-gray-400 text-center tracking-wider">GREEN</span>
                    <input type="range" min="0" max="2" step="0.1" value={customSettings.gMulti} onChange={(e) => updateSetting('gMulti', e.target.value)} className="w-full h-2 bg-neutral-700 rounded-full appearance-none accent-gray-300" />
                  </div>
                  <div className="flex-1 flex flex-col gap-2">
                    <span className="text-[10px] text-gray-400 text-center tracking-wider">BLUE</span>
                    <input type="range" min="0" max="2" step="0.1" value={customSettings.bMulti} onChange={(e) => updateSetting('bMulti', e.target.value)} className="w-full h-2 bg-neutral-700 rounded-full appearance-none accent-gray-300" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(['custom', 'crunch', 'gameboy', 'grayscale', 'sepia', 'cyberpunk'] as FilterMode[]).map(mode => (
                  <button 
                    key={mode} 
                    onClick={() => changeMode(mode)} 
                    className={activeMode === mode ? "underline" : ""}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="h-24 px-6 flex justify-between items-center bg-black/90 backdrop-blur-md shadow-[0_-10px_30px_rgba(0,0,0,0.8)]">
          <button 
            onClick={takePhoto} 
            className="text-lg underline font-black tracking-widest active:scale-95 transition-transform drop-shadow-[0_0_8px_rgba(220,38,38,0.8)]"
          >
            capture
          </button>
          
          <div className="flex flex-col gap-2 items-start">
            <button 
              onClick={toggleMenu}
              className={`text-xs underline tracking-widest transition-colors ${isMenuOpen ? 'text-red-400' : 'text-white/60 hover:text-white'}`}
            >
              {isMenuOpen ? 'close' : 'settings'}
            </button>
            <button 
              onClick={toggleCamera}
              className="text-xs underline tracking-widest text-white/60 hover:text-white"
            >
              swap cam
            </button>
          </div>
        </div>
      </div>

      <div 
        className={`absolute bottom-32 left-1/2 -translate-x-1/2 px-5 py-2 bg-white text-black text-xs font-bold rounded-full shadow-lg transition-all duration-300 z-50 whitespace-nowrap ${
          toastMessage ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
        }`}
      >
        {toastMessage}
      </div>
    </div>
  );
}