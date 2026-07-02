// Helper: Convert SVG element to PNG data URL
export async function svgToPngDataUrl(svg: SVGSVGElement, width: number, height: number): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Clone the SVG to avoid modifying the original
      const clonedSvg = svg.cloneNode(true) as SVGSVGElement;
      
      // Get actual dimensions from SVG
      const svgWidth = svg.getAttribute('width') 
        ? parseFloat(svg.getAttribute('width')!) 
        : svg.viewBox?.baseVal?.width || width;
      const svgHeight = svg.getAttribute('height') 
        ? parseFloat(svg.getAttribute('height')!) 
        : svg.viewBox?.baseVal?.height || height;
      
      // Ensure cloned SVG has explicit dimensions and xmlns for blob rendering
      if (!clonedSvg.getAttribute("xmlns")) {
        clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg")
      }
      if (!clonedSvg.hasAttribute('width')) {
        clonedSvg.setAttribute('width', svgWidth.toString());
      }
      if (!clonedSvg.hasAttribute('height')) {
        clonedSvg.setAttribute('height', svgHeight.toString());
      }
      
      // Preserve viewBox if it exists
      if (svg.viewBox?.baseVal) {
        const viewBox = svg.viewBox.baseVal;
        clonedSvg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
      }
      
      // Remove any script tags for security
      const scripts = clonedSvg.querySelectorAll('script');
      scripts.forEach(script => script.remove());
      
      // Create SVG data URL
      const svgData = new XMLSerializer().serializeToString(clonedSvg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      
      // Create image element to convert SVG to canvas
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      const timeout = setTimeout(() => {
        URL.revokeObjectURL(url);
        reject(new Error('Image loading timeout'));
      }, 10000);
      
      img.onload = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement('canvas');
          // Use 3x scaling for high-quality output
          const scale = 3;
          canvas.width = width * scale;
          canvas.height = height * scale;
          const ctx = canvas.getContext('2d', { 
            willReadFrequently: false,
          });
          
          if (!ctx) {
            URL.revokeObjectURL(url);
            reject(new Error('Could not get canvas context'));
            return;
          }
          
          // Enable high-quality rendering
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // White background so transparent SVGs render in PDF
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, width, height)

          // Scale the context and draw the image
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, width, height);
          
          // Export at high quality
          const dataUrl = canvas.toDataURL('image/png', 1.0);
          URL.revokeObjectURL(url);
          resolve(dataUrl);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      
      img.onerror = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load SVG image'));
      };
      
      img.src = url;
    } catch (error) {
      reject(new Error(`SVG conversion error: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
}

