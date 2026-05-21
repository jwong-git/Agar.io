// Tracks the mouse position in screen-space (pixels relative to the canvas).
export class MouseInput {
  x = 0;
  y = 0;

  constructor(canvas: HTMLCanvasElement) {
    // initialize to center so the cell doesn't fly off before first move
    this.x = canvas.width / 2;
    this.y = canvas.height / 2;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      // The drawing buffer may be smaller than the displayed canvas (see the
      // render-buffer cap in main.ts), so convert display px → buffer px.
      this.x = (e.clientX - rect.left) * (canvas.width / rect.width);
      this.y = (e.clientY - rect.top) * (canvas.height / rect.height);
    });
  }
}
