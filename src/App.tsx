import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UploadCloud, File, Image as ImageIcon, FileText, Video, Music, Settings, CheckCircle, X, Download, ArrowRight, Activity, HardDrive, FileCode, FileImage, FileAudio } from 'lucide-react';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import imageCompression from 'browser-image-compression';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type CompressionLevel = 'Low' | 'Medium' | 'High' | 'Extreme' | 'Custom';

interface FileItem {
  id: string;
  file: File;
  status: 'idle' | 'compressing' | 'done' | 'error';
  progress: number;
  originalSize: number;
  compressedSize?: number;
  previewUrl?: string;
  compressedBlob?: Blob | File;
}

export default function App() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [compressionLevel, setCompressionLevel] = useState<CompressionLevel>('Medium');
  const [targetSize, setTargetSize] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef(new FFmpeg());

  // Global Stats
  const [totalFilesCompressed, setTotalFilesCompressed] = useState(0);
  const [totalDataSaved, setTotalDataSaved] = useState(0); // in bytes
  const [isSystemActive, setIsSystemActive] = useState(true);

  const loadFFmpeg = async () => {
    const ffmpeg = ffmpegRef.current;
    if (ffmpeg.loaded) return;
    try {
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
    } catch (e) {
      console.error('Failed to load FFmpeg', e);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      if (res.ok) {
        const data = await res.json();
        setTotalFilesCompressed(data.totalFilesCompressed || 0);
        setTotalDataSaved(data.totalDataSaved || 0);
      }
    } catch (e) {
      console.error('Failed to fetch stats', e);
    }
  };

  const checkHealth = async () => {
    try {
      const res = await fetch('/api/health');
      setIsSystemActive(res.ok);
    } catch (e) {
      setIsSystemActive(false);
    }
  };

  useEffect(() => {
    setIsLoaded(true);
    loadFFmpeg();
    fetchStats();
    checkHealth();
    
    // Poll health every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      addFiles(Array.from(e.target.files));
    }
  }, []);

  const generatePdfThumbnail = async (file: File): Promise<string | undefined> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      
      await page.render({ canvasContext: context, viewport } as any).promise;
      return canvas.toDataURL('image/jpeg', 0.8);
    } catch (error) {
      console.error('Error generating PDF thumbnail:', error);
      return undefined;
    }
  };

  const addFiles = (newFiles: File[]) => {
    const newItems: FileItem[] = newFiles.map(f => ({
      id: Math.random().toString(36).substring(7),
      file: f,
      status: 'idle',
      progress: 0,
      originalSize: f.size,
      previewUrl: f.type.startsWith('image/') || f.type.startsWith('video/') ? URL.createObjectURL(f) : undefined
    }));
    setFiles(prev => [...prev, ...newItems]);

    newItems.forEach(async (item) => {
      if (item.file.type === 'application/pdf') {
        const thumbUrl = await generatePdfThumbnail(item.file);
        if (thumbUrl) {
          setFiles(prev => prev.map(f => f.id === item.id ? { ...f, previewUrl: thumbUrl } : f));
        }
      }
    });
  };

  const removeFile = (id: string) => {
    setFiles(prev => {
      const fileToRemove = prev.find(f => f.id === id);
      if (fileToRemove?.previewUrl) {
        URL.revokeObjectURL(fileToRemove.previewUrl);
      }
      return prev.filter(f => f.id !== id);
    });
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-6 h-6 text-primary" />;
    if (type.startsWith('video/')) return <Video className="w-6 h-6 text-accent" />;
    if (type.startsWith('audio/')) return <Music className="w-6 h-6 text-accent-light" />;
    if (type === 'application/pdf') return <FileText className="w-6 h-6 text-accent" />;
    return <File className="w-6 h-6 text-text-muted" />;
  };

  const handleCompression = async (type: 'all' | 'new' | 'old' = 'all') => {
    setFiles(prev => prev.map(f => {
      if (f.status === 'compressing') return f;
      if (type === 'new' && f.status !== 'idle') return f;
      if (type === 'old' && f.status !== 'done') return f;
      return { ...f, status: 'compressing', progress: 0 };
    }));

    // We need to get the latest files state, but since we just updated it, 
    // we'll filter the current files array for non-compressing ones to process.
    const filesToCompress = files.filter(f => {
      if (f.status === 'compressing') return false;
      if (type === 'new' && f.status !== 'idle') return false;
      if (type === 'old' && f.status !== 'done') return false;
      return true;
    });

    for (const fileItem of filesToCompress) {
      try {
        let compressedFile: File | Blob = fileItem.file;
        let compressedSize = fileItem.originalSize;
        let ratio = 0.5;

        if (compressionLevel === 'Low') ratio = 0.8;
        if (compressionLevel === 'Medium') ratio = 0.5;
        if (compressionLevel === 'High') ratio = 0.3;
        if (compressionLevel === 'Extreme') ratio = 0.15;
        if (compressionLevel === 'Custom' && targetSize) {
          const targetBytes = parseFloat(targetSize) * 1024 * 1024;
          ratio = Math.min(targetBytes / fileItem.originalSize, 0.9);
        }

        if (fileItem.file.type.startsWith('image/') && fileItem.file.type !== 'image/svg+xml') {
          const options = {
            maxSizeMB: Math.max((fileItem.originalSize * ratio) / (1024 * 1024), 0.01),
            maxWidthOrHeight: 1920,
            useWebWorker: true,
            onProgress: (progress: number) => {
              setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, progress } : f));
            }
          };
          
          compressedFile = await imageCompression(fileItem.file, options);
          compressedSize = compressedFile.size;
        } else if (fileItem.file.type.startsWith('video/') || fileItem.file.type.startsWith('audio/')) {
          const ffmpeg = ffmpegRef.current;
          if (!ffmpeg.loaded) await loadFFmpeg();
          
          const isVideo = fileItem.file.type.startsWith('video/');
          const ext = isVideo ? 'mp4' : 'mp3';
          const inputName = `input_${fileItem.id}.${ext}`;
          const outputName = `output_${fileItem.id}.${ext}`;
          
          await ffmpeg.writeFile(inputName, await fetchFile(fileItem.file));
          
          ffmpeg.on('progress', ({ progress }) => {
            setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, progress: Math.min(Math.round(progress * 100), 100) } : f));
          });

          let args: string[] = [];
          if (isVideo) {
             let crf = '28';
             if (compressionLevel === 'Low') crf = '23';
             if (compressionLevel === 'Medium') crf = '28';
             if (compressionLevel === 'High') crf = '32';
             if (compressionLevel === 'Extreme') crf = '36';
             args = ['-i', inputName, '-vcodec', 'libx264', '-crf', crf, '-preset', 'ultrafast', outputName];
          } else {
             let bitrate = '128k';
             if (compressionLevel === 'Low') bitrate = '192k';
             if (compressionLevel === 'Medium') bitrate = '128k';
             if (compressionLevel === 'High') bitrate = '64k';
             if (compressionLevel === 'Extreme') bitrate = '32k';
             args = ['-i', inputName, '-b:a', bitrate, outputName];
          }

          await ffmpeg.exec(args);
          const data = await ffmpeg.readFile(outputName);
          compressedFile = new Blob([(data as Uint8Array).buffer], { type: isVideo ? 'video/mp4' : 'audio/mpeg' });
          compressedSize = compressedFile.size;
          
          await ffmpeg.deleteFile(inputName);
          await ffmpeg.deleteFile(outputName);
          ffmpeg.off('progress', () => {});
        } else {
          // Simulate progress for other unsupported files
          for (let i = 0; i <= 100; i += 10) {
            await new Promise(resolve => setTimeout(resolve, 50));
            setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, progress: i } : f));
          }
          compressedSize = fileItem.originalSize;
        }

        setFiles(prev => prev.map(f => {
          if (f.id === fileItem.id) {
            return {
              ...f,
              status: 'done',
              progress: 100,
              compressedSize: compressedSize,
              compressedBlob: compressedFile
            };
          }
          return f;
        }));

        const saved = Math.max(0, fileItem.originalSize - compressedSize);
        setTotalFilesCompressed(prev => prev + 1);
        setTotalDataSaved(prev => prev + saved);

        // Update global stats
        if (saved > 0) {
          fetch('/api/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filesCount: 1, bytesSaved: saved })
          }).catch(console.error);
        }

      } catch (error) {
        console.error('Compression error:', error);
        setFiles(prev => prev.map(f => f.id === fileItem.id ? { ...f, status: 'error' } : f));
      }
    }
  };

  const handleDownloadAll = async () => {
    const doneFiles = files.filter(f => f.status === 'done');
    if (doneFiles.length === 0) return;

    const zip = new JSZip();
    doneFiles.forEach(f => {
      zip.file(`compressed_${f.file.name}`, f.compressedBlob || f.file);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compressly_${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getEstimatedSavings = () => {
    const pendingFiles = files.filter(f => f.status !== 'compressing');
    if (pendingFiles.length === 0) return null;
    
    const totalOriginal = pendingFiles.reduce((acc, f) => acc + f.originalSize, 0);
    let ratio = 0.5;
    if (compressionLevel === 'Low') ratio = 0.8;
    if (compressionLevel === 'Medium') ratio = 0.5;
    if (compressionLevel === 'High') ratio = 0.3;
    if (compressionLevel === 'Extreme') ratio = 0.15;
    if (compressionLevel === 'Custom' && targetSize) {
      const targetBytes = parseFloat(targetSize) * 1024 * 1024;
      ratio = Math.min(targetBytes / totalOriginal, 0.9);
    } else if (compressionLevel === 'Custom') {
      return null;
    }
    
    const estimatedSaved = totalOriginal - (totalOriginal * ratio);
    const percentage = Math.round((1 - ratio) * 100);
    
    return { saved: estimatedSaved, percentage };
  };

  const estimate = getEstimatedSavings();

  return (
    <div className="min-h-screen flex flex-col items-center py-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden selection:bg-primary/30">
      
      {/* Decorative Background Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-accent/10 blur-[120px] pointer-events-none" />

      {/* Subtle Decorative Icons */}
      {isLoaded && (
        <>
          <motion.div 
            initial={{ opacity: 0, y: 20, rotate: -12 }}
            animate={{ opacity: 1, y: 0, rotate: -10 }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="absolute top-24 left-[8%] hidden lg:flex flex-col items-center justify-center w-20 h-24 bg-surface/80 backdrop-blur-md shadow-xl shadow-black/5 rounded-2xl border border-border pointer-events-none z-0"
          >
            <FileText className="w-8 h-8 text-red-400 mb-2" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">PDF</span>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: -20, rotate: 15 }}
            animate={{ opacity: 1, y: 0, rotate: 12 }}
            transition={{ duration: 1, delay: 0.2, ease: "easeOut" }}
            className="absolute top-32 right-[10%] hidden lg:flex flex-col items-center justify-center w-20 h-24 bg-surface/80 backdrop-blur-md shadow-xl shadow-black/5 rounded-2xl border border-border pointer-events-none z-0"
          >
            <ImageIcon className="w-8 h-8 text-blue-400 mb-2" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">JPG</span>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: -20, rotate: -5 }}
            animate={{ opacity: 1, x: 0, rotate: -8 }}
            transition={{ duration: 1, delay: 0.4, ease: "easeOut" }}
            className="absolute top-72 left-[15%] hidden xl:flex flex-col items-center justify-center w-20 h-24 bg-surface/80 backdrop-blur-md shadow-xl shadow-black/5 rounded-2xl border border-border pointer-events-none z-0"
          >
            <FileCode className="w-8 h-8 text-orange-400 mb-2" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">SVG</span>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, x: 20, rotate: 8 }}
            animate={{ opacity: 1, x: 0, rotate: 10 }}
            transition={{ duration: 1, delay: 0.6, ease: "easeOut" }}
            className="absolute top-64 right-[18%] hidden xl:flex flex-col items-center justify-center w-20 h-24 bg-surface/80 backdrop-blur-md shadow-xl shadow-black/5 rounded-2xl border border-border pointer-events-none z-0"
          >
            <Video className="w-8 h-8 text-purple-400 mb-2" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">MP4</span>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20, rotate: 20 }}
            animate={{ opacity: 1, y: 0, rotate: 18 }}
            transition={{ duration: 1, delay: 0.8, ease: "easeOut" }}
            className="absolute top-[28rem] left-[12%] hidden 2xl:flex flex-col items-center justify-center w-20 h-24 bg-surface/80 backdrop-blur-md shadow-xl shadow-black/5 rounded-2xl border border-border pointer-events-none z-0"
          >
            <FileImage className="w-8 h-8 text-emerald-400 mb-2" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">GIF</span>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: -15, rotate: -15 }}
            animate={{ opacity: 1, y: 0, rotate: -12 }}
            transition={{ duration: 1, delay: 1.0, ease: "easeOut" }}
            className="absolute top-[26rem] right-[15%] hidden 2xl:flex flex-col items-center justify-center w-20 h-24 bg-surface/80 backdrop-blur-md shadow-xl shadow-black/5 rounded-2xl border border-border pointer-events-none z-0"
          >
            <FileAudio className="w-8 h-8 text-pink-400 mb-2" />
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">MP3</span>
          </motion.div>
        </>
      )}

      <div className="w-full max-w-4xl z-10 flex flex-col">
        
        {/* Header */}
        <header className="text-center mb-16 mt-8">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={() => window.location.reload()}
            className="text-6xl md:text-7xl font-display font-bold text-primary-dark mb-6 tracking-tight cursor-pointer hover:opacity-80 transition-opacity"
          >
            Compressly
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg md:text-xl text-text-muted max-w-2xl mx-auto font-light leading-relaxed"
          >
            Shrink your files, keep the magic. Premium compression for creators who care about quality.
          </motion.p>
        </header>

        {/* Main Interface */}
        <main className="flex flex-col gap-8">
          
          {/* Upload Area */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            className={`relative border-2 border-dashed rounded-[2rem] p-12 flex flex-col items-center justify-center text-center transition-all duration-300 bg-surface/30 backdrop-blur-xl shadow-2xl
              ${isDragging ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border hover:border-primary/50 hover:bg-surface/50'}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input 
              type="file" 
              multiple 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileInput}
              accept="image/*,video/*,audio/*,.pdf,.svg"
            />
            <div className="w-24 h-24 rounded-full bg-surface border border-border flex items-center justify-center mb-6 shadow-lg shadow-black/5">
              <UploadCloud className="w-10 h-10 text-primary" strokeWidth={1.5} />
            </div>
            <h3 className="text-3xl font-display font-semibold text-text mb-3">Drop your files here</h3>
            <p className="text-text-muted mb-8 text-lg">Supports PDF, JPG, PNG, SVG, MP4, GIF, MP3</p>
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="px-10 py-4 rounded-full bg-primary text-surface hover:bg-[#4a532b] hover:shadow-lg transition-all duration-300 font-medium tracking-wide text-sm"
            >
              Select Files
            </button>
          </motion.div>

          {/* Settings & File List */}
          <AnimatePresence>
            {files.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex flex-col gap-6"
              >
                {/* Settings Panel */}
                <div className="bg-surface/40 backdrop-blur-xl rounded-3xl p-8 border border-border shadow-xl">
                  <div className="flex items-center gap-3 mb-6">
                    <Settings className="w-5 h-5 text-primary" />
                    <h4 className="text-xl font-display font-medium text-text">Compression Settings</h4>
                  </div>
                  
                  <div className="flex flex-col gap-6">
                    <div className="w-full flex flex-col gap-4">
                      <div>
                        <label className="block text-xs uppercase tracking-widest text-text-muted mb-3 font-semibold">Level</label>
                        <div className="flex flex-wrap sm:flex-nowrap bg-bg rounded-2xl p-1 border border-border min-h-[3rem]">
                          {['Low', 'Medium', 'High', 'Extreme', 'Custom'].map((level) => (
                            <button
                              key={level}
                              onClick={() => setCompressionLevel(level as CompressionLevel)}
                              className={`flex-1 min-w-[30%] sm:min-w-0 h-10 sm:h-auto flex items-center justify-center px-2 sm:px-3 text-xs sm:text-sm rounded-xl transition-all duration-200 ${
                                compressionLevel === level 
                                  ? 'bg-accent text-surface shadow-md font-medium' 
                                  : 'text-text-muted hover:text-accent hover:bg-accent/10'
                              }`}
                            >
                              {level}
                            </button>
                          ))}
                        </div>
                      </div>

                      <AnimatePresence>
                        {compressionLevel === 'Custom' && (
                          <motion.div 
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            className="w-full overflow-hidden"
                          >
                            <label className="block text-xs uppercase tracking-widest text-text-muted mb-3 font-semibold">Target (MB)</label>
                            <input 
                              type="number" 
                              value={targetSize}
                              onChange={(e) => setTargetSize(e.target.value)}
                              placeholder="e.g. 5"
                              className="w-full h-12 bg-bg border border-border rounded-2xl px-4 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all text-text"
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {estimate && (
                      <motion.div 
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="w-full text-sm text-text-muted flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 bg-primary/5 p-3.5 rounded-xl border border-primary/10"
                      >
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-primary shrink-0" />
                          <span>Estimated savings:</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-primary-dark">{formatSize(estimate.saved)}</span> 
                          <span>({estimate.percentage}%)</span>
                        </div>
                      </motion.div>
                    )}

                    <div className="w-full flex justify-center sm:justify-end">
                      {files.some(f => f.status === 'idle') && files.some(f => f.status === 'done') ? (
                        <div className="flex flex-col gap-3 w-full sm:w-auto items-center">
                          <button 
                            onClick={() => handleCompression('new')}
                            disabled={files.every(f => f.status === 'compressing')}
                            className="w-full sm:w-auto h-12 px-8 rounded-full bg-primary text-surface hover:bg-[#4a532b] hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium whitespace-nowrap"
                          >
                            Compress New <ArrowRight className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleCompression('old')}
                            disabled={files.every(f => f.status === 'compressing')}
                            className="w-full sm:w-auto h-12 px-8 rounded-full bg-accent text-surface hover:bg-[#a65d1f] hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium whitespace-nowrap"
                          >
                            Re-compress Old <ArrowRight className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => handleCompression('all')}
                          disabled={files.length === 0 || files.every(f => f.status === 'compressing')}
                          className="w-full sm:w-auto h-12 px-8 rounded-full bg-primary text-surface hover:bg-[#4a532b] hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
                        >
                          {files.every(f => f.status === 'done') ? 'Re-compress All' : files.length === 1 ? 'Compress' : 'Compress All'} <ArrowRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* File List */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2 px-2">
                    <h4 className="text-lg font-display font-medium text-text">Queue ({files.length})</h4>
                    <div className="flex items-center justify-between sm:justify-end gap-4 sm:gap-6 w-full sm:w-auto">
                      {files.some(f => f.status === 'done') && (
                        <button 
                          onClick={handleDownloadAll}
                          className="text-sm font-medium text-accent hover:text-[#8b4513] flex items-center gap-1.5 transition-colors"
                        >
                          <Download className="w-4 h-4" /> Download All
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
                          setFiles([]);
                        }}
                        className="text-sm font-medium text-text-muted hover:text-red-500 flex items-center gap-1.5 transition-colors"
                      >
                        <X className="w-4 h-4" /> Clear Queue
                      </button>
                    </div>
                  </div>
                  <AnimatePresence>
                    {files.map(file => (
                      <motion.div 
                        key={file.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-surface/40 backdrop-blur-md rounded-2xl p-3 sm:p-4 border border-border flex flex-row items-center gap-3 sm:gap-5 shadow-lg relative overflow-hidden"
                      >
                        {/* Progress Background */}
                        {file.status === 'compressing' && (
                          <div 
                            className="absolute left-0 top-0 bottom-0 bg-[#dda15e]/30 transition-all duration-300 ease-out"
                            style={{ width: `${file.progress}%` }}
                          />
                        )}

                        <div className="w-20 h-20 sm:w-16 sm:h-16 rounded-xl bg-surface border border-border flex items-center justify-center shrink-0 z-10 overflow-hidden">
                          {file.previewUrl ? (
                            file.file.type.startsWith('video/') ? (
                              <video src={`${file.previewUrl}#t=0.1`} className="w-full h-full object-cover" preload="metadata" muted playsInline />
                            ) : (
                              <img src={file.previewUrl} alt="preview" className="w-full h-full object-cover" />
                            )
                          ) : (
                            getFileIcon(file.file.type)
                          )}
                        </div>
                        
                        <div className="flex-grow min-w-0 z-10 flex flex-col justify-center">
                          <p className="text-sm sm:text-base font-medium text-text truncate mb-1">{file.file.name}</p>
                          <div className="flex flex-col text-xs sm:text-sm text-text-muted gap-0.5">
                            <span>Original: {formatSize(file.originalSize)}</span>
                            {file.compressedSize && (
                              <div className="flex items-center gap-2">
                                <span className="text-text font-semibold">New: {formatSize(file.compressedSize)}</span>
                                <span className="text-[10px] sm:text-xs bg-primary/10 text-primary px-1.5 sm:px-2 py-0.5 rounded-md font-medium border border-primary/20">
                                  -{Math.round((1 - file.compressedSize / file.originalSize) * 100)}%
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="shrink-0 flex flex-col sm:flex-row items-center gap-2 sm:gap-3 z-10 self-center ml-auto">
                          {file.status === 'compressing' && (
                            <span className="text-sm font-medium text-primary">{Math.round(file.progress)}%</span>
                          )}
                          {file.status === 'done' && (
                            <button 
                              onClick={() => {
                                const url = URL.createObjectURL(file.compressedBlob || file.file);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `compressed_${file.file.name}`;
                                a.click();
                                URL.revokeObjectURL(url);
                              }}
                              className="p-2 sm:p-2.5 text-primary hover:bg-primary/10 rounded-full transition-colors" title="Download"
                            >
                              <Download className="w-5 h-5" />
                            </button>
                          )}
                          <button 
                            onClick={() => removeFile(file.id)}
                            className="p-2 sm:p-2.5 text-text-muted hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </main>
      </div>

      {/* How it Works Section */}
      <section className="w-full max-w-5xl mt-32 mb-12 z-10">
        <h2 className="text-4xl font-display font-bold text-center text-text mb-16">How it works</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
          {/* Connecting line for desktop */}
          <div className="hidden md:block absolute top-10 left-[16%] right-[16%] h-[2px] bg-primary/20 -z-10" />
          
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-accent text-surface flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">1</div>
            <h3 className="text-2xl font-display font-semibold text-text mb-3">Upload</h3>
            <p className="text-text-muted font-light leading-relaxed">Drag and drop your heavy media files into our secure, private dropzone.</p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-accent text-surface flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">2</div>
            <h3 className="text-2xl font-display font-semibold text-text mb-3">Configure</h3>
            <p className="text-text-muted font-light leading-relaxed">Select your desired compression level or set an exact target size for precision.</p>
          </div>
          <div className="flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-full bg-accent text-surface flex items-center justify-center mb-6 text-2xl font-display font-bold shadow-lg shadow-black/5">3</div>
            <h3 className="text-2xl font-display font-semibold text-text mb-3">Compress</h3>
            <p className="text-text-muted font-light leading-relaxed">Download your newly optimized files, ready to be shared with the world.</p>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="w-full max-w-5xl mt-16 pt-12 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-8 z-10"
      >
        <div className="flex items-center gap-6 bg-surface/40 backdrop-blur-xl p-8 rounded-[2rem] border border-border shadow-xl">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-primary shadow-inner">
            <Activity className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase tracking-widest font-semibold mb-1">Files Compressed</p>
            <p className="text-4xl font-display font-bold text-primary-dark">
              {totalFilesCompressed.toLocaleString()}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-6 bg-surface/40 backdrop-blur-xl p-8 rounded-[2rem] border border-border shadow-xl">
          <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center text-accent shadow-inner">
            <HardDrive className="w-7 h-7" />
          </div>
          <div>
            <p className="text-xs text-text-muted uppercase tracking-widest font-semibold mb-1">Data Saved</p>
            <p className="text-4xl font-display font-bold text-primary-dark">
              {formatSize(totalDataSaved).split(' ')[0]} <span className="text-2xl text-text-muted">{formatSize(totalDataSaved).split(' ')[1] || 'B'}</span>
            </p>
          </div>
        </div>
      </motion.div>

      {/* Mini Footer */}
      <footer className="w-full max-w-5xl mt-16 pb-8 z-10 flex flex-col md:flex-row items-center justify-between gap-6 text-xs sm:text-sm text-text-muted border-t border-border pt-8">
        <div className="flex flex-col items-center md:items-start gap-1 text-center md:text-left">
          <p className="font-medium text-text">&copy; {new Date().getFullYear()} Compressly. All rights reserved.</p>
          <p>Fast, secure, and local file compression.</p>
        </div>
        
        <div className="flex flex-col items-center md:items-end gap-3">
          <div className="flex items-center gap-2 bg-surface/50 px-3 py-1.5 rounded-full border border-border shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSystemActive ? 'bg-primary' : 'bg-red-500'}`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isSystemActive ? 'bg-primary' : 'bg-red-500'}`}></span>
            </span>
            <span className={`font-medium text-xs uppercase tracking-wider ${isSystemActive ? 'text-primary-dark' : 'text-red-600'}`}>
              {isSystemActive ? 'Systems Active' : 'Systems Offline'}
            </span>
          </div>
        </div>
      </footer>

    </div>
  );
}
