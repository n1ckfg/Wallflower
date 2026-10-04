// Light colour / levels panel, toggled with the C key. Ported from gltFpsViewer,
// where the swatches set the background; here they set the room light's colour
// (darker swatches act as a dimmer, black turns the light off).
//
// The panel builds its own DOM (the swatch grid and sliders are repetitive
// enough that generating them beats hand-writing the markup) and reports
// changes through callbacks; it knows nothing about Three.js.

const SWATCHES = [
    '#fff5e6', '#3a86ff', '#2ec4b6', '#7bc47f',
    '#ffd166', '#f4a261', '#ff7e5f', '#e05780',
    '#8e7dbe', '#ffffff', '#87ceeb', '#9aa0a6',
    '#3d4148', '#000000'
];

const DEFAULTS = {
    light: '#fff5e6',
    blackPoint: 0.0,
    whitePoint: 1.0,
    gamma: 1.0
};

// Keeps the black and white points from crossing (or collapsing) each other.
const MIN_GAP = 0.02;

export class Palette {

    constructor( options = {} ) {
        this.onLightChange = options.onLightChange ?? ( () => {} );
        this.onLevelsChange = options.onLevelsChange ?? ( () => {} );

        this.light = options.light ?? DEFAULTS.light;
        this.levels = {
            blackPoint: DEFAULTS.blackPoint,
            whitePoint: DEFAULTS.whitePoint,
            gamma: DEFAULTS.gamma
        };

        this._sliders = {};
        this._build();
    }

    get isOpen() {
        return this.el.style.display !== 'none';
    }

    /**
     * True if the given node lives inside the panel — used by the viewer to
     * ignore clicks and key presses aimed at the controls.
     */
    contains( node ) {
        return node instanceof Node && this.el.contains( node );
    }

    open() {
        this.el.style.display = 'block';
    }

    close() {
        this.el.style.display = 'none';
    }

    toggle() {
        if ( this.isOpen ) this.close();
        else this.open();
    }

    setLight( hex ) {
        this.light = hex;
        this._colorInput.value = hex;
        this._hexLabel.textContent = hex;

        for ( const swatch of this._swatches ) {
            swatch.classList.toggle( 'selected', swatch.dataset.color === hex );
        }

        this.onLightChange( hex );
    }

    setLevels( levels, priority = null ) {
        Object.assign( this.levels, levels );
        this._clampLevels( priority );
        this._syncSliders();
        this.onLevelsChange( { ...this.levels } );
    }

    reset() {
        this.setLevels( {
            blackPoint: DEFAULTS.blackPoint,
            whitePoint: DEFAULTS.whitePoint,
            gamma: DEFAULTS.gamma
        } );
        this.setLight( DEFAULTS.light );
    }

    /**
     * @private
     */
    _build() {
        const el = document.createElement( 'div' );
        el.id = 'palette';
        el.style.display = 'none';
        el.innerHTML = `
            <div class="palette-header">
                <span>display</span>
                <button class="palette-reset" type="button">reset</button>
            </div>
            <div class="palette-section">
                <div class="palette-label">light</div>
                <div class="palette-swatches"></div>
                <label class="palette-custom">
                    <input class="palette-color" type="color">
                    <span class="palette-hex"></span>
                </label>
            </div>
            <div class="palette-section palette-levels">
                <div class="palette-label">levels</div>
            </div>
            <div class="palette-hint">C to close</div>
        `;

        this.el = el;
        this._colorInput = el.querySelector( '.palette-color' );
        this._hexLabel = el.querySelector( '.palette-hex' );

        const grid = el.querySelector( '.palette-swatches' );
        this._swatches = SWATCHES.map( hex => {
            const swatch = document.createElement( 'button' );
            swatch.type = 'button';
            swatch.className = 'palette-swatch';
            swatch.dataset.color = hex;
            swatch.title = hex;
            swatch.style.backgroundColor = hex;
            swatch.addEventListener( 'click', () => this.setLight( hex ) );
            grid.appendChild( swatch );
            return swatch;
        } );

        this._colorInput.addEventListener( 'input', () => this.setLight( this._colorInput.value ) );

        const levels = el.querySelector( '.palette-levels' );
        this._addSlider( levels, 'blackPoint', 'black', 0, 1, 0.01, 2 );
        this._addSlider( levels, 'whitePoint', 'white', 0, 1, 0.01, 2 );
        this._addSlider( levels, 'gamma', 'gamma', 0.2, 3, 0.05, 2 );

        el.querySelector( '.palette-reset' ).addEventListener( 'click', () => this.reset() );

        document.body.appendChild( el );

        this.setLight( this.light );
        this._syncSliders();
    }

    /**
     * @private
     */
    _addSlider( parent, key, label, min, max, step, decimals ) {
        const row = document.createElement( 'div' );
        row.className = 'palette-slider';
        row.innerHTML = `
            <span class="palette-slider-label">${label}</span>
            <input type="range" min="${min}" max="${max}" step="${step}">
            <span class="palette-value"></span>
        `;

        const input = row.querySelector( 'input' );
        input.value = this.levels[ key ];
        input.addEventListener( 'input', () => {
            this.setLevels( { [ key ]: parseFloat( input.value ) }, key );
        } );

        parent.appendChild( row );
        this._sliders[ key ] = { input, value: row.querySelector( '.palette-value' ), decimals };
    }

    /**
     * Keep the levels in range and the black point below the white point. The
     * slider the user is currently dragging wins; the other one gives way.
     * @private
     */
    _clampLevels( priority ) {
        const l = this.levels;

        l.blackPoint = Math.min( Math.max( l.blackPoint, 0 ), 1 - MIN_GAP );
        l.whitePoint = Math.min( Math.max( l.whitePoint, MIN_GAP ), 1 );
        l.gamma = Math.min( Math.max( l.gamma, 0.2 ), 3 );

        if ( l.whitePoint - l.blackPoint < MIN_GAP ) {
            if ( priority === 'blackPoint' ) l.whitePoint = l.blackPoint + MIN_GAP;
            else l.blackPoint = l.whitePoint - MIN_GAP;
        }
    }

    /**
     * @private
     */
    _syncSliders() {
        for ( const [ key, slider ] of Object.entries( this._sliders ) ) {
            slider.input.value = this.levels[ key ];
            slider.value.textContent = this.levels[ key ].toFixed( slider.decimals );
        }
    }
}
