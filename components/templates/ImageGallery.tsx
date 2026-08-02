"use client";
import { useState, useRef, useEffect } from "react";
import { Upload, Trash2, Image as ImageIcon, AlertCircle } from "lucide-react";

interface TemplateImage {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  order: number;
}

interface ImageGalleryProps {
  templateId: string;
  onImagesChange?: (images: TemplateImage[]) => void;
}

export function ImageGallery({ templateId, onImagesChange }: ImageGalleryProps) {
  const [images, setImages] = useState<TemplateImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing images
  useEffect(() => {
    async function loadImages() {
      setLoading(true);
      try {
        const res = await fetch(`/api/templates/images?templateId=${templateId}`);
        if (res.ok) {
          const imgs = await res.json();
          setImages(imgs);
        }
      } catch (err) {
        console.error("Failed to load images:", err);
      } finally {
        setLoading(false);
      }
    }
    if (templateId) loadImages();
  }, [templateId]);

  async function handleFileUpload(files: FileList) {
    if (!files.length) return;

    setError("");
    setUploading(true);

    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("templateId", templateId);

        const res = await fetch("/api/templates/upload-image", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Upload failed");
          break;
        }

        const uploaded = await res.json();
        setImages((prev) => [...prev, uploaded]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deleteImage(imageId: string) {
    if (!confirm("Delete this image?")) return;

    try {
      const res = await fetch(`/api/templates/images?imageId=${imageId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setImages((prev) => prev.filter((img) => img.id !== imageId));
      }
    } catch (err) {
      console.error("Failed to delete image:", err);
      setError("Failed to delete image");
    }
  }

  function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-800 mb-2">
          Instruction Images <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-slate-500 mb-3">
          Add photos to help guests understand check-in, parking, amenities, or access. Images will be included in messages sent to guests.
        </p>

        {/* Upload area */}
        <div
          onDragEnter={() => setDragActive(true)}
          onDragLeave={() => setDragActive(false)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            handleFileUpload(e.dataTransfer.files);
          }}
          className={`border-2 border-dashed rounded-xl p-6 text-center transition cursor-pointer ${
            dragActive ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-slate-50"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => handleFileUpload(e.target.files!)}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex flex-col items-center gap-2 mx-auto"
          >
            <Upload className="w-6 h-6 text-slate-400" />
            <div>
              <p className="text-sm font-medium text-slate-700">
                {uploading ? "Uploading..." : "Click to upload or drag & drop"}
              </p>
              <p className="text-xs text-slate-500">PNG, JPG, WebP, GIF (max 5MB each)</p>
            </div>
          </button>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Images gallery */}
      {images.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">Attached images ({images.length})</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {images.map((img) => (
              <div key={img.id} className="group relative">
                <div className="aspect-square bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden">
                  <ImageIcon className="w-6 h-6 text-slate-400" />
                </div>
                <div className="mt-1 min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate" title={img.fileName}>
                    {img.fileName.length > 20 ? img.fileName.substring(0, 17) + "..." : img.fileName}
                  </p>
                  <p className="text-[10px] text-slate-500">{formatSize(img.size)}</p>
                </div>
                <button
                  onClick={() => deleteImage(img.id)}
                  className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white p-1 rounded-lg opacity-0 group-hover:opacity-100 transition shadow-sm"
                  title="Delete image"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
