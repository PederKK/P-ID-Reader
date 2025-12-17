
async function saveAnnotatedPDF(pdfBytes, tags) {
    if (!pdfBytes) {
        alert("No PDF loaded to save.");
        return;
    }

    const { PDFDocument, rgb, degrees } = PDFLib;

    try {
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();

        for (const tag of tags) {
            // tag.page is 1-based
            const pageIndex = tag.page - 1;
            if (pageIndex < 0 || pageIndex >= pages.length) continue;
            
            const page = pages[pageIndex];
            
            if (!tag.pdfRect) continue;

            const { x, y, width, height, rotation } = tag.pdfRect;

            // Determine color based on status
            let color = rgb(1, 0.9, 0); // Yellow default (rgba(255, 230, 0))
            let borderColor = rgb(0.9, 0.7, 0);
            
            if (tag.status === 'Correct') {
                color = rgb(0.16, 0.65, 0.27); // Green #28a745
                borderColor = rgb(0.1, 0.5, 0.2);
            } else if (tag.status === 'Incorrect') {
                color = rgb(0.86, 0.21, 0.27); // Red #dc3545
                borderColor = rgb(0.7, 0.1, 0.1);
            }

            // Draw rectangle
            // Note: pdf-lib draws from bottom-left. 
            // Our y is likely the baseline. We might need to adjust if the highlight looks off.
            // But since we are using the same coordinates as the extraction (which are PDF coords),
            // it should be relatively correct, except for the height direction.
            // In PDF, positive Y is up.
            // If we draw a rect at (x,y) with height h, it goes UP from y.
            // The text is usually drawn at baseline y.
            // So the rect should start slightly below y (descent) and go up.
            // However, without font metrics, we are guessing.
            // Let's assume y is baseline.
            // We'll shift y down by 20% of height to cover descenders.
            
            page.drawRectangle({
                x: x,
                y: y - (height * 0.2), 
                width: width,
                height: height,
                color: color,
                opacity: 0.4,
                borderColor: borderColor,
                borderWidth: 1,
                rotate: degrees(rotation || 0)
            });
        }

        const pdfDataUri = await pdfDoc.saveAsBase64({ dataUri: true });
        
        const link = document.createElement('a');
        link.href = pdfDataUri;
        link.download = 'audited_pid.pdf';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (err) {
        console.error("Error saving PDF:", err);
        alert("Failed to save PDF: " + err.message);
    }
}
