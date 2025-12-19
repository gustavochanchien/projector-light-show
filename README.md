# Projector Light Show (Web)

A browser-based, real-time **projector / light-show visualizer** inspired by **Blaize V3** by **BodgedButWorks**, adapted and extended for modern web browsers using HTML5 Canvas and JavaScript.

This version is designed to run entirely in the browser, making it easy to deploy, customize, and control from laptops or tablets connected to projectors.

View it at: [https://github.com/gustavochanchien/projector-light-show](https://github.com/gustavochanchien/projector-light-show) 

> Based on **Blaize V3**
> Original project: [https://github.com/bodgedbutworks/Blaize_V3](https://github.com/bodgedbutworks/Blaize_V3) 

---

## Features

* **30+ animated visual presets and not too hard to add more**
* **Real-time controls** for speed, size, strobe, trails, brightness, and BPM
* **Multicolor mode** with dual color selection
* **Beat-reactive visuals**

  * Microphone input
  * Automatic color and/or preset switching

* **Pop-out control panel**

  * Ideal for dual-screen or projector setups

---

## File Overview

### `index.html`

The main entry point for the application 

* Sets up the `<canvas>` used for rendering
* Defines the control panel UI
* Wires up all scripts and styles
* Includes accessibility and responsive layout considerations

---

### `app.js`

The core application logic and rendering engine 

Handles:

* Canvas setup and resizing
* Preset state management
* Rendering loop and animation timing
* Motion path blending
* Beat detection (mic input)
* UI bindings and event handling
* Pop-out window synchronization

This file acts as the **brain** of the application.

---

### `presets.js`

Preset definitions and drawing logic 

* Defines preset names
* Contains the individual drawing routines for each visual mode
* Many presets are directly inspired by or adapted from Blaize V3 concepts
* Designed so presets can be expanded or replaced independently

---

### `styles.css`

Visual styling for the UI and control panel 

---

## Relationship to Blaize V3

This project is **not a drop-in replacement** for Blaize V3.

* It is a **web-native reinterpretation**
* Preset ideas, behaviors, and visual language are inspired by Blaize V3
* The architecture, UI, and rendering pipeline are redesigned for browsers
* Additional features (motion blending, pop-out UI, responsive layout) are web-specific

Full credit and thanks to **BodgedButWorks** for the original Blaize V3 concept and inspiration.

Original repository:
[https://github.com/bodgedbutworks/Blaize_V3](https://github.com/bodgedbutworks/Blaize_V3)

---

## License & Attribution
MIT License but also if you want extend or remix this version, attribution to **Blaize V3 by BodgedButWorks** is appreciated.