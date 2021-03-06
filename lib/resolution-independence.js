module.exports = function (less) {

	/**
	* The configurable options that can be passed into `ResolutionIndependence`.
	*
	* @typedef {Object} ResolutionIndependence~Options
	* @property {Number} baseSize - The root font-size we wish to use to base all of our conversions
	*	upon.
	* @property {String} riUnit - The unit of measurement we wish to use for resolution-independent
	*	units.
	* @property {String} unit - The unit of measurement we wish to convert to resolution-independent
	*	units.
	* @property {String} absoluteUnit - The unit of measurement to ignore for
	*	resolution-independence conversion, and instead should be 1:1 converted to our `_unit` unit.
	* @property {Number} minUnitSize - The minimum unit size (as an absolute value) that any
	*	measurement should be valued at the lowest device resolution we wish to support. This allows
	*	for meaningful measurements that are not unnecessarily scaled down excessively.
	* @property {Number} minSize - The root font-size corresponding to the lowest device resolution
	*	we wish to support. This is utilized in conjunction with the `minUnitSize` property.
	* @property {Number} precision - How precise our measurements will be, namely the maximum amount
	*	of fractional digits that will appear in our converted measurements.
	*/
	function ResolutionIndependencePlugin (opts) {
		this._visitor = new less.visitors.Visitor(this);
		this.configure(opts);
	}

	// The set of properties that can have comma-separated values, some of which can be in pixel units
	var csvProps = [
		'background',
		'background-size',
		'background-position'
	];

	ResolutionIndependencePlugin.prototype = {

		/**
		* The root font-size we wish to use to base all of our conversions upon.
		*
		* @type {Number}
		* @default 24
		* @private
		*/
		_baseSize: 24,

		/**
		* The unit of measurement we wish to use for resolution-independent units.
		*
		* @type {String}
		* @default 'rem'
		* @private
		*/
		_riUnit: 'rem',

		/**
		* The unit of measurement we wish to convert to resolution-independent units.
		*
		* @type {String}
		* @default 'px'
		* @private
		*/
		_unit: 'px',

		/**
		* The unit of measurement to ignore for resolution-independence conversion, and instead
		* should be 1:1 converted to our `_unit` unit.
		*
		* @type {String}
		* @default 'apx'
		* @private
		*/
		_absoluteUnit: 'apx', // "absolute" px

		/**
		* The minimum unit size (as an absolute value), in our base unit `_unit`, that any
		* measurement should be set to in the resolution corresponding to our minimum root font-size
		* `_minSize`.
		*
		* @type {Number}
		* @default 1
		* @private
		*/
		_minUnitSize: 1,

		/**
		* The root font-size corresponding to the lowest device resolution we wish to support. The
		* determination for adjusting our measurements based on the minimum unit `_minUnitSize` are
		* dependent on this value.
		*
		* @type {String}
		* @default 16
		* @private
		*/
		_minSize: 16,

		/**
		* This number is a representation of how precise our measurements should be. More
		* specifically, this number corresponds to the maximum number of fractional digits in our
		* computed measurements. This will not affect measurements that utilize the `_absoluteUnit`
		* unit, or measurements that are adjusted to the minimum unit size, in the event that
		* `_minUnitSize` has more precision than what is specified here, as `_minUnitSize` would be
		* user-overridden and assumed intentional.
		*
		* @type {Number}
		* @default 5
		* @private
		*/
		_precision: 5,

		/*
		* Entry point
		*/
		run: function (root) {
			return this._visitor.visit(root);
		},

		/**
		* Updates the parameters for this plugin based on a set of options
		*
		* @param {Object} opts - A hash of options.
		* @public
		*/
		configure: function (opts) {
			this._baseSize = (opts && opts.baseSize !== undefined) ? opts.baseSize : this._baseSize;
			this._riUnit = (opts && opts.riUnit !== undefined) ? opts.riUnit : this._riUnit;
			this._unit = (opts && opts.unit !== undefined) ? opts.unit : this._unit;
			this._absoluteUnit = (opts && opts.absoluteUnit !== undefined) ? opts.absoluteUnit : this._absoluteUnit;
			this._minUnitSize = (opts && opts.minUnitSize !== undefined) ? opts.minUnitSize : this._minUnitSize;
			this._minSize = (opts && opts.minSize !== undefined) ? opts.minSize : this._minSize;
			this._precision = (opts && opts.precision !== undefined) ? opts.precision : this._precision;

			// One-time computation of the minimum scale factor that will be used for determining
			// whether or not to clamp measurement values to the minimum unit size `_minUnitSize`.
			this._minScaleFactor = this._minSize / this._baseSize;
		},

		/*
		* Hook into each rule declaration node
		*
		* @param {Object} node - The current LESS node to parse.
		* @public
		*/
		visitDeclaration: function (node) {
			var ruleNode = node && !node.inline && node.value;
			this._currentPropName = node.name;
			this.processRuleNode(ruleNode);
		},

		/**
		* Processes a LESS rule node for conversion.
		*
		* @param {Object} ruleNode - A LESS rule node we wish to parse and convert.
		* @private
		*/
		processRuleNode: function (ruleNode) {
			var parsedString = '',
				isString = false,
				csvStrings, idx;

			if (Array.isArray(ruleNode.args)) { // The value(s) of a CSS function call
				for (idx = 0; idx < ruleNode.args.length; idx++) {
					this.updateNode(ruleNode.args[idx]);
				}
			} else { // Value(s) that are not parameters of a function call
				isString = typeof ruleNode.value == 'string';
				if (csvProps.indexOf(this._currentPropName) > -1 && isString) {
					csvStrings = ruleNode.value.split(',');
				}

				if (csvStrings && csvStrings.length) { // Multiple sets of comma-separated string values
					for (idx = 0; idx < csvStrings.length; idx++) {
						parsedString += (parsedString ? ', ' : '') + this.parseString(ruleNode, csvStrings[idx]);
					}
				} else if (isString) { // Multiple string values
					parsedString = this.parseString(ruleNode);
				} else { // A single value object
					this.updateNode(ruleNode);
				}

				if (parsedString) ruleNode.value = parsedString;
			}
		},

		/**
		* Processes an array of LESS rule nodes for conversion.
		*
		* @param {Object[]} ruleNodes - An array of LESS rule nodes we wish to parse and convert.
		* @private
		*/
		processRuleNodes: function (ruleNodes) {
			for (var idx = 0; idx < ruleNodes.length; idx++) {
				this.processRuleNode(ruleNodes[idx]);
			}
		},

		/**
		* Takes a LESS rule node and updates the value to a resolution-independent measurement. If
		* the rule node's value is a string value, the value and unit will be set as the updated
		* value of this node. If the rule node consists of a value object and unit object, both of
		* these objects will be updated with the appropriate values.
		*
		* @param {Object} ruleNode - The rule node we are currently examining and will convert.
		* @private
		*/
		updateNode: function (ruleNode) {
			if (ruleNode) {
				var value = ruleNode.value,
					unitNode = ruleNode.unit,
					result;

				// Multiple property values where at least one value is a LESS variable (LESS
				// automatically converts all of the values into array items)
				if (Array.isArray(value)) {
					this.processRuleNodes(value);
				}

				if (unitNode) {
					result = this.parseValueObject(value, unitNode);
					ruleNode.value = result.value;
					unitNode.numerator[0] = result.unit;
				} else {
					ruleNode.value = this.parseValueString(value);
				}
			}
		},

		/**
		* Parses a string value (which might need to be parsed into individual values).
		*
		* @param {Object} ruleNode - The rule node we are currently examining and will convert.
		* @param {String} [stringValues] - The optional set of string values; if not present, then
		*	the node's value will be used.
		* @return {String[]} The set of parsed and converted values.
		* @private
		*/
		parseString: function (ruleNode, stringValues) {
			var value = stringValues || ruleNode.value;
			stringValues = value.match(/\d+[\.]?\d+[^\s\.!]*|[!]*[^\s!]+/g);

			if (stringValues) return stringValues.map(this.parseValueString.bind(this)).join(' ');
		},

		/**
		* Parses measurement values that have a separate unit object.
		*
		* @param {Number} value - The measurement value we wish to convert.
		* @param {Object} unitNode - An object representing the unit associated with the measurement
		*	value.
		* @returns {Object} An object with `value` and `unit` properties that represent the
		*	measurement in resolution-independent units.
		* @private
		*/
		parseValueObject: function (value, unitNode) {
			var unit = (unitNode && unitNode.numerator && unitNode.numerator.length && unitNode.numerator[0]) || unitNode.backupUnit,
				scaledValue;

			// The standard unit to convert (if no unit, we assume the base unit)
			if (unit == this._unit) {
				scaledValue = Math.abs(value * this._minScaleFactor);
				return (scaledValue && scaledValue <= this._minUnitSize) ?
					{
						value: Math.abs(value) < this._minUnitSize ? value : this._minUnitSize * (value < 0 ? -1 : 1),
						unit: this._unit
					} :
					{
						value: this.convertValue(value),
						unit: this._riUnit
					};
			}
			// The absolute unit to convert to our standard unit
			else if (unit == this._absoluteUnit) {
				return {
					value: value,
					unit: this._unit
				};
			}

			return {
				value: value,
				unit: unit
			};
		},

		/**
		* Parses measurements that contain both the value and unit as a single string.
		*
		* @param {String} value - The measurement in the base unit which we wish to convert.
		* @returns {String} The measurement, in resolution-independent units.
		* @private
		*/
		parseValueString: function (value) {
			var scaledValue;

			// String value in our absolute unit
			if (value && value.toString().slice(-1*this._absoluteUnit.length) == this._absoluteUnit) {
				return parseFloat(value) + this._unit;
			}
			// String value in our to-be-converted unit
			else if (value && value.toString().slice(-1*this._unit.length) == this._unit) {
				value = parseFloat(value);
				scaledValue = Math.abs(value * this._minScaleFactor);
				return (scaledValue && scaledValue <= this._minUnitSize) ?
					(Math.abs(value) < this._minUnitSize ?
						value + this._unit : this._minUnitSize * (value < 0 ? -1 : 1) + this._unit) :
					this.convertValue(value) + this._riUnit;
			}

			return value;
		},

		/**
		* Converts a value from our base unit to a value in resolution-independent units.
		*
		* @param {Number} value - The value, in base units, to be converted to a value that is in
		*	resolution-independent units.
		* @returns {Number} - The converted value in resolution-independent units.
		* @private
		*/
		convertValue: function (value) {
			return parseFloat((value / this._baseSize).toFixed(this._precision));
		}

	};

	// Backward compatibility for Less 2.x
	ResolutionIndependencePlugin.prototype.visitRule = ResolutionIndependencePlugin.prototype.visitDeclaration;

	return ResolutionIndependencePlugin;
};
