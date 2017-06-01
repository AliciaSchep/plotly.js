/**
* Copyright 2012-2017, Plotly, Inc.
* All rights reserved.
*
* This source code is licensed under the MIT license found in the
* LICENSE file in the root directory of this source tree.
*/


'use strict';

var id2name = require('./axis_ids').id2name;
var scaleZoom = require('./scale_zoom');

var ALMOST_EQUAL = require('../../constants/numerical').ALMOST_EQUAL;

var FROM_BL = require('../../constants/alignment').FROM_BL;


module.exports = function enforceAxisConstraints(gd) {
    var fullLayout = gd._fullLayout;
    var constraintGroups = fullLayout._axisConstraintGroups;

    var i, j, axisID, ax, normScale, mode, factor;

    for(i = 0; i < constraintGroups.length; i++) {
        var group = constraintGroups[i];
        var axisIDs = Object.keys(group);

        var minScale = Infinity;
        var maxScale = 0;
        // mostly matchScale will be the same as minScale
        // ie we expand axis ranges to encompass *everything*
        // that's currently in any of their ranges, but during
        // autorange of a subset of axes we will ignore other
        // axes for this purpose.
        var matchScale = Infinity;
        var normScales = {};
        var axes = {};

        // find the (normalized) scale of each axis in the group
        for(j = 0; j < axisIDs.length; j++) {
            axisID = axisIDs[j];
            axes[axisID] = ax = fullLayout[id2name(axisID)];

            if(!ax._inputDomain) ax._inputDomain = ax.domain.slice();
            if(!ax._inputRange) ax._inputRange = ax.range.slice();

            // set axis scale here so we can use _m rather than
            // having to calculate it from length and range
            ax.setScale();

            // abs: inverted scales still satisfy the constraint
            normScales[axisID] = normScale = Math.abs(ax._m) / group[axisID];
            minScale = Math.min(minScale, normScale);
            if(ax._constraintShrinkable) {
                // this has served its purpose, so remove it
                delete ax._constraintShrinkable;
            }
            else {
                matchScale = Math.min(matchScale, normScale);
            }
            maxScale = Math.max(maxScale, normScale);
        }

        // Do we have a constraint mismatch? Give a small buffer for rounding errors
        if(minScale > ALMOST_EQUAL * maxScale) continue;

        // now increase any ranges we need to until all normalized scales are equal
        for(j = 0; j < axisIDs.length; j++) {
            axisID = axisIDs[j];
            normScale = normScales[axisID];
            ax = axes[axisID];
            mode = ax.constrain;

            // even if the scale didn't change, if we're shrinking domain
            // we need to recalculate in case `constraintoward` changed
            if(normScale !== matchScale || mode === 'domain') {
                factor = normScale / matchScale;

                if(mode === 'range') {
                    scaleZoom(ax, factor);
                }
                else {
                    // mode === 'domain'

                    var inputDomain = ax._inputDomain;
                    var domainShrunk = (ax.domain[1] - ax.domain[0]) /
                        (inputDomain[1] - inputDomain[0]);
                    var rangeShrunk = (ax.r2l(ax.range[1]) - ax.r2l(ax.range[0])) /
                        (ax.r2l(ax._inputRange[1]) - ax.r2l(ax._inputRange[0]));

                    factor /= domainShrunk;

                    if(factor * rangeShrunk < 1) {
                        // we've asked to magnify the axis more than we can just by
                        // enlarging the domain - so we need to constrict range
                        ax.domain = ax._input.domain = inputDomain.slice();
                        scaleZoom(ax, factor);
                        continue;
                    }

                    if(rangeShrunk < 1) {
                        // the range has previously been constricted by ^^, but we've
                        // switched to the domain-constricted regime, so reset range
                        ax.range = ax._input.range = ax._inputRange.slice();
                        factor *= rangeShrunk;
                    }

                    // TODO
                    if(ax.autorange) {
                        /*
                         * range & factor may need to change because range was
                         * calculated for the larger scaling, so some pixel
                         * paddings may get cut off when we reduce the domain.
                         *
                         * This is easier than the regular autorange calculation
                         * because we already know the scaling `m`, but we still
                         * need to cut out impossible constraints (like
                         * annotations with super-long arrows). That's what
                         * outerMin/Max are for - if the expansion was going to
                         * go beyond the original domain, it must be impossible
                         */
                        var rangeMin = Math.min(ax.range[0], ax.range[1]);
                        var rangeMax = Math.max(ax.range[0], ax.range[1]);
                        var rangeCenter = (rangeMin + rangeMax) / 2;
                        var halfRange = rangeMax - rangeCenter;
                        var outerMin = rangeCenter - halfRange * factor;
                        var outerMax = rangeCenter + halfRange * factor;

                        updateDomain(ax, factor);
                        ax.setScale();
                        var m = Math.abs(ax._m);
                        var newVal;
                        var k;

                        for(k = 0; k < ax._min.length; k++) {
                            newVal = ax._min[i].val - ax._min[i].pad / m;
                            if(newVal > outerMin && newVal < rangeMin) {
                                rangeMin = newVal;
                            }
                        }

                        for(k = 0; k < ax._max.length; k++) {
                            newVal = ax._max[i].val + ax._max[i].pad / m;
                            if(newVal < outerMax && newVal > rangeMax) {
                                rangeMax = newVal;
                            }
                        }

                        ax.range = ax._input.range = (ax.range[0] < ax.range[1]) ?
                            [rangeMin, rangeMax] : [rangeMax, rangeMin];

                        /*
                         * In principle this new range can be shifted vs. what
                         * you saw at the end of a zoom operation, like if you
                         * have a big bubble on one side and a small bubble on
                         * the other.
                         * To fix this we'd have to be doing this calculation
                         * continuously during the zoom, but it's enough of an
                         * edge case and a subtle enough effect that I'm going
                         * to ignore it for now.
                         */
                        var domainExpand = (rangeMax - rangeMin) / (2 * halfRange);
                        factor /= domainExpand;
                    }

                    updateDomain(ax, factor);
                }
            }
        }
    }
};

function updateDomain(ax, factor) {
    var inputDomain = ax._inputDomain;
    var centerFraction = FROM_BL[ax.constraintoward];
    var center = inputDomain[0] + (inputDomain[1] - inputDomain[0]) * centerFraction;

    ax.domain = ax._input.domain = [
        center + (inputDomain[0] - center) / factor,
        center + (inputDomain[1] - center) / factor
    ];
}
