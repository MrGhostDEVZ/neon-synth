# NEÓN

Sintetizador polifónico y visualizador de audio hecho solo con **Web Audio API + Canvas 2D**. Cero dependencias, cero build, cero `npm install`.

**Demo:** https://mrghostdevz.github.io/neon-synth/

## Qué incluye

- 18 voces de polifonía con robo de voces.
- Dos osciladores con detune y sub-oscilador una octava abajo.
- Filtro paso-bajo con resonancia y envolvente de corte propia.
- Envolvente ADSR completa.
- LFO con dos destinos: corte del filtro y tono (vibrato).
- Cadena de efectos: saturación → compresor → delay con retroalimentación → reverb por convolución con impulso generado en runtime.
- Arpegiador con planificador de *lookahead* sobre el reloj del `AudioContext`.
- Teclado en pantalla de 25 teclas, mapeo de teclado de computadora y Web MIDI.
- Visualizador con modos barras y radial, picos, estela y partículas.
- Cinco presets y grabación a `.webm`.

## Uso

1. Abre la demo (o `index.html` en local) y pulsa **Encender audio**: los navegadores exigen un gesto del usuario para crear el `AudioContext`.
2. Toca con el mouse, el dedo o las teclas `z–m` y `q–u`.

En tablet funciona a pantalla completa desde el icono: en Chrome o Safari, menú → **Añadir a pantalla de inicio**. El service worker deja la app disponible también sin conexión.

El Web MIDI necesita contexto seguro: la URL de Pages ya es HTTPS, así que un controlador MIDI funciona ahí pero no abriendo el archivo con `file://`.

## Estructura

```
index.html          interfaz (todo el HTML se genera desde JS)
css/styles.css      tema neón, layout de escritorio y tablet
js/synth.js         motor de audio (SynthEngine)
js/visualizer.js    dibujo del canvas (Visualizer)
js/app.js           controles, teclado, presets, MIDI, grabación
manifest.json       metadatos PWA
sw.js               caché offline
icon.svg            icono de la app
```

## Notas de implementación

- Un `AudioContext` nace `suspended`: se reanuda dentro del clic de **Encender audio**.
- `exponentialRampToValueAtTime` no acepta 0: todas las rampas terminan en `0.0005`.
- Los `pointerup` se escuchan en `window`, así una tecla no se queda pegada al soltar el dedo fuera del teclado; `pointerId` permite tocar acordes con varios dedos.
- El canvas se reescala por `devicePixelRatio` con `getBoundingClientRect`.
- En táctil se amplían los controles (`@media (pointer: coarse)`) y se desactiva el zoom por doble toque con `touch-action: manipulation`.
