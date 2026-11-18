// Wesen aus Bert Chans Lenia-Katalog (github.com/Chakazul/Lenia, Python/animals.json).
// Copyright (c) 2018 Bert Chan, MIT-Lizenz: Die Daten dürfen benutzt und weitergegeben werden, solange dieser Hinweis
// dabei steht.
//
// Jedes Wesen lebt nur mit seinen eigenen Regeln (R, μ, σ, dt): beim Setzen werden die Regler mitgestellt.
// Die Zellen sind lauflängenkodiert (RLE wie bei Game-of-Life-Mustern), Werte 0 … 255:
//   .         0
//   A … X     1 … 24
//   pA … pX   25 … 48, qA … 49 …, bis yO = 255 (Vorbuchstabe zählt Blöcke von 24)
//   Zahl davor  so oft wiederholen
//   $         nächste Zeile (mit Zahl davor: so viele Zeilen)
// Alle stehen hier mit Chans Kern (eine Beule, „kn 1“) und Glocke („gn 1“), also genau der Regel aus lenia.js.

export const WESEN = [
  { name: "Orbium (Gleiter)", latein: "Orbium unicaudatus", R: 13, dt: 0.1, mu: 0.15, sigma: 0.015,
    zellen: "7.MD6.qL$6.pKqEqFURpApBRAqQ$5.VqTrSsBrOpXpWpTpWpUpCrQ$4.CQrQsTsWsApITNPpGqGvL$3.IpIpWrOsGsBqXpJ4.LsFrL$A.DpKpSpJpDqOqUqSqE5.ExD$qL.pBpTT2.qCrGrVrWqM5.sTpP$.pGpWpD3.qUsMtItQtJ6.tL$.uFqGH3.pXtOuR2vFsK5.sM$.tUqL4.GuNwAwVxBwNpC4.qXpA$2.uH5.vBxGyEyMyHtW4.qIpL$2.wV5.tIyG3yOxQqW2.FqHpJ$2.tUS4.rM2yOyJyOyHtVpPMpFqNV$2.HsR4.pUxAyOxLxDxEuVrMqBqGqKJ$3.sLpE3.pEuNxHwRwGvUuLsHrCqTpR$3.TrMS2.pFsLvDvPvEuPtNsGrGqIP$4.pRqRpNpFpTrNtGtVtStGsMrNqNpF$5.pMqKqLqRrIsCsLsIrTrFqJpHE$6.RpSqJqPqVqWqRqKpRXE$8.OpBpIpJpFTK!" },
  { name: "Orbium mit zwei Schwänzen", latein: "Orbium bicaudatus", R: 13, dt: 0.1, mu: 0.15, sigma: 0.014,
    zellen: "13.pK$14.qV$6.VpA.MpEpKpITqV$4.BpPpNrIrEqDpWpOpLpUqNvT$4.IqRrNsPsKqHJ3.GqOuC$4.TrLsTrPrLpS6.uUD$3.SpWqNrBqLpRqPqE6.vA$2.FpTpMLpHqPqHrVsPrS5.qUqA$K.pCpRG.ErFsRsVuSuPqN4.CrR$pA.pTU3.rWuBuRvXwTwKpF4.rCH$.tPqHH3.qFvAwUwVyJyKwNL2.DqLR$.pGsGA4.vPxSyDxE2yOuHS.XqJT$2.xIE4.sCyHyOvLvRyFxCsGpVpXqGP$2.VsU4.DxQyOvVuSwDwQuBrMqSqCF$3.vG5.tEyKwVvIvKvMtVrXqTpM$4.sU4.qFvDwMvNuUuDsUrKqDO$4.qCrDJ2.pPsKuGuHtOsQrNqKpC$5.pTqTpVpNqFrJsGsKrVrDqFpFD$6.QqCqJqPqVqXqRqHpOTC$8.LWpFpEXPG!" },
  { name: "Gyrorbium (kreist)", latein: "Gyrorbium gyrans", R: 13, dt: 0.1, mu: 0.156, sigma: 0.0224,
    zellen: "10.EL2QLE$7.TpU2qHqCpXpUpNpFL$4.JrVtTuKuPuKtLrXqTqHqCpPpDG$3.qWtDqRpKqEsMuXvBtGrApXpUpSpIO$2.rQrN4.pAuAvRtTrIpUpIpKpFO$.pSsM6.tJwFuNsPsFrVpPpDL$.uFB6.tJ2yO2yLyOyDsKL$pDuC6.pFxW3yOwIwD2xPqH$rNtV5.EsMxCyIyOwXtJsMtJwFuX$sHuSV3.EpDvOwFxEwQsRqR2qHsFvWE$rQvJsWpPQpKpSqCvEvBuCpD3.BpDtGrQ$pXuKvMuPtLsWsCrIuCtBrS6.qWrQ$EsKvEwXyBwLtVrVsCrDqH6.pXrG$.qHtVxJyOwQrQpNqJpPV6.qJqE$.JsUxMyOrX10.pFqRJ$2.rQxPwIpI9.pKqJT$2.qJxEuPpKB7.qCpP$2.EvOvMpPO5.TrGqH$3.sCyOqEpIOEBOqHqEsRtG$4.xMsMqJqCpXqJqRpIqOuCtBsF$5.xPrAqTqMpSE.rSsMrLqRqHV.TpS$6.vErDE2.VpPB$7.pIrNqHpKQ!" },
  { name: "Scutium (Schild)", latein: "Scutium solidus", R: 13, dt: 0.1, mu: 0.29, sigma: 0.045,
    zellen: "5.pGQ$6.sUsDqRR$4.VpXrJwKvNtXrW$2.ApVrGrWsIwKyOyDwTuNO$2.qArOrIqIpPpTxH2yOyIvKqG$rVpIrNrJpH4.xP3yOvFqWA$sKvNsKqE5.pI4yOuHqPC$sNxBuMpD5.JuN3yOwXsUpN$sGxFyOT5.pCtIyF3yOuKqUH$rPwXyOxT5.qKtSxS3yOvIrQT$pQwK2yOtWXJXqHsGuWxW3yOvPsApC$.vQ3yOuVsLsGsXuMwOyK3yOvHrVpC$.rKyK3yOxEwBwCwXyE3yOxQuMrJU$.WvC5yOyM5yOwFtJqOL$2.rVwO9yOwWuMsApOC$2.pLtBwK6yOyJwQuTsQqLP$3.qHsWvEwUxTyCxRwWvRuGsNqSpA$3.HqBrUtHuGuPuLtVsXrSqIXB$4.DpDqEqW2rIqWqGpJN$6.ENTUPHA!" },
  { name: "Discutium (Doppelschild)", latein: "Discutium solidus", R: 13, dt: 0.1, mu: 0.356, sigma: 0.063,
    zellen: "8.AEG2JHFB$6.HUpKpWqGqKqLqHpXpOpCOE$4.FpCqGrGsCsQtBtEtDsUsMrXrIqNpRVF$3.MqArPtDuHvDvPvUvVvSvMvAuMtTsWrWqUpRQA$2.MqMsSuSwIxKyDyKyMyKyFxUxKwUwCvGuGtCrTqKpBD$.DqKtHvWyC10yOyHxLwLvHtXsMqUpHE$.pMsWwG14yOyMxJwBuOsVrBpHD$.rLvM6yOyLyDyByGyL6yOyAwOuVsXqVX$VtMxS5yOyGwR2vXwJxCxTyI5yOyLwTuUsOqHM$qGvDyM5yOvWtRtDtHtWuTvSwRxNyEyN4yOwRuJrUpKB$rKwFxXyK3yOxRsJqNqIqSrMsJtIuIvHwIxJyH3yOyMwDtJqOL$sCwLwWxU3yOuRT2.GpBqAqXrXsXuBvIwWyH3yOxTuVrSpB$sHuSvLxAyK2yOrO6.OpOqPrTtFvDxJ4yOwGsUpRA$rXsStVvVxW2yOpO8.IpOrEtJwM4yOxLtSqGC$qBqQsFuPxByLxWqWV9.pFrWwD4yOyJuIqOD$.NqOtGvTxPuLsDqUpKJ8.rDxD5yOuOqOB$2.WrRuFwDrP2rTrHqLpJL6.sK6yOuIqE$3.qBsIrPpKqAqOrBrIrFqOpTXJCBKxI5yOxXtMpI$3.HqJ3.HpBpVqQrGrKrEqQqHqGuE4yOyMyNwNsBB$11.NpNqLrFrTsDsO2yOyNyE2xSyCuLqA$13.GpLqNrPuKyDxUxDwJwCwLvUrV$15.NpTwDwCvMuPtXuCvAsVS$16.GtNtIsPrTrLsDsTpL$16.pEqSqIpNVpBqFpH$16.A5.G!" },
  { name: "Paraptera (Flügel)", latein: "Paraptera arcus labens", R: 13, dt: 0.1, mu: 0.347, sigma: 0.057,
    zellen: "10.C2DC$7.KpBpOpXqDqCpUpMpAMD$5.JpOqVrWsQtAtBsVsMrXrGqMpPTE$4.TqTsUuLvLvXwAvSvIuUuFtOsSrTqRpOPA$3.SrPuKwSyH2yOyJxRxEwPwDvNuTtUsSrMqGpCH$3.rOvFyJ6yOyMyGxXxLwRvTuQtLsEqWpRQA$2.qMuU13yOxRwNvHuCsUrOqGpCG$.JtGxX6yO2yDyL5yOyGxAvTuPtKsDqVpON$.qOvQxQyM4yOwRwBwMxLyI5yOyHxBvXuWtWsSrKqBVD$.sMvLwXyI3yOvNtJtLuLvUxGyH4yOyLxHwLvVvHuKtFrWqMpFG$VsOuHwIyF2yOwKrFqJrGsOuCvRxAxTyCyBxWwUwCvXwDwEvSuXtSsHqUpMJ$pLrCtHvUyB2yOrL.BpIqUsLtVvCvRvTvNuNtTtUuOvSwRxBwOvLuCsPrDpRN$.pXsOvKxTyOvJK3.pEqQrWsRsVsPrSqVqTrOtCvFxGyJyExEvVuJsWrKpVP$.pDsAuVxIyDrSpF4.SpQpWpQW2.JpTsAuWxX3yOxNwCuPtDrOqAQ$.MrKuDwNsUrUqMpAD10.NrLvGxV4yOxNwBuRtFrQqBR$2.qRtEqUqMrJrNqWqDpKpBMC7.rQvHxR4yOyIxAvTuPtFrRqAQ$2.pSK.RpWqUrJrNrOrHqSpRN6.sFvPxRyKyN2yOxWwXwHvOuPtGrQqAQ$7.UpPqGqRrCrHrEqKpFH3.pXtXwRxSxUxOxHwUwAvUwBwDvRuRtGrPpXP$10.FUpOqMrCrAqKpVpNqTuTxPyJxPwGvDuLtMtJuDvIwKwRwBuTtFrOpVM$13.QpUqSrFrMsEwO3yOwQtKrUqOqIrBsLuOwRxSxKwHuUtDrLpRH$15.SpOqEuTxUyI2yOuPpW3.pDrHuDxF2yOxUwHuRtArDpHB$17.rCuWvRwXyHyGrT5.qOuFxT3yOxUwDuJsOqPS$17.rTsMtSvLxMvBpW5.qNuRxN4yOxKvQtVrWpSD$16.FpIqLsDuGtVrOqMG4.rAuKxF4yOyMwQuXtBqTQ$18.TqUrFpHqXrDpD4.qWuAwNyD4yOxLvUuBrTpI$19.K2.qArFqJN3.qNtHvJwXyC3yOyDwQuXsQpXD$22.TqLrBqDM2.pWsDtUvHwPxTyM2yOxLvTtKqNH$23.pCqQrDqBI.VqPsCtMuVwKxV2yOyHwPuArAM$24.pJrDrFpH2.VqHrQtFvExI3yOxJuMrEO$24.DqGrPqIF2.KpXrWuLxJ3yOxXuPrDM$25.pIrJrDV3.NrEvAyL3yOyGuLqSH$25.JqQrNqCJ2.FsQxX4yOxVtTqCB$26.pQrHrFpWUJrWyI5yOwTsOpE$26.KqIrMrNrDtN7yOuXqWF$27.pAqPrTuF7yOwQsMpA$28.pCrNxMxSxTxRxPxSyCxGtIpQ$29.uHvD3vJvOwFwOtFpQ$28.qDsBsIsKsLsStMuPrXV$28.WpHpKpLpRqKrQqA$33.L!" },
  { name: "Paraptera (hüpft)", latein: "Paraptera cavus salien", R: 13, dt: 0.1, mu: 0.251, sigma: 0.0332,
    zellen: "7.QqEqWqVqGpEF$5.VsIuQvHuXuKuAtErOpOG$4.qJuSxIxBvFtPtBtN2uJsUqKQ$3.pQuPyJyOvQsLqPqHrNtSvOvIsVqGRB$3.sBxKyOyEtUqNpEpKrDuBwQxCuWrSpPO$3.uB2yOxJsKpRpHqLtDwMyOyJvWsSqHpDH$2.rBxI2yOxSrXqAqNsTwP3yOwGtMrCpTWD$.qVvMxI2yOwMsUrTsRvOyE3yOwWuUsTrDpXV$.tJvLxJ2yOtDqUrOtEvExN4yOxLvOtKrQqEQ$BtFvLxKyOsOpRpFqKsDuEwKyI4yOwXuRsWrNqBK$ItDvLvKrNpP2.pFqVsRuRwQyByLxRuUtGsTsPsGrGpKD$RtAuBqRrDpQ3.pMqXsItKtVrAH2.pFrFsMsDqLS$TsRqFpTqSpXI2.CJWpM6.qHtBsXrDpJI$MrIHVqFqIpD12.rBuNtQrKpWpCND$4.pGqFqEpDE10.uKwOtTrKqOqJqBpLQA$5.pBpXqGpRP8.sIyOxPtLrXsCsKsDrLqLpIJ$6.IpIqDqFpC7.2yOxWuJuKvEuRtRsVsDrCpRPC$8.IpMqFpNH3.pF6yOxAuCsNsOtDsSrGpRTHA$10.pHqLqKqAqHrWxGyOyEyK3yOsUpHWqNtGuQtIrCpRpCPD$11.pHqNrMsEvXwTvNvUxV2yOqQ3.DsVwOvUtGrNqRqBpEE$12.pApUvVuJtGtIvByFyOD5.sTyLyDvPuEtOsVrLpPC$13.tKsFrGrIsQvPyOqP6.tP2yOyAwUwLvTuJsGpO$12.qSpNOVqNtFwUsOU6.vD4yOyMxGvQuHrXS$16.qTuFsErPJ5.pLvOyN4yOwLuPuDtKqP$16.rQuEqMrDP5.qKuIxEyM2yOxOuDsHsNtLsFM$15.IsJDpMqQpO5.pAsLvCwPxOxXuPrRqHrCsXtCpJ$15.pF2.FpPqHT4.KrPtFuMvLuRsEqEpMqLsUtOpV$19.CpLqCO3.SqFrOsTtStBqXpVpTrFtOuCpW$20.DpUpSF3.SqBrIsOtOrJqXrOtDvAuGpI$21.PqDpJ4.RqIsGuMuNuBuUvXwKtNG$22.pMqGpFF3.qCvDyKyOyMyIyBwHrO$22.HpWqIpRpGpBpFtF5yOxIuAV$23.RqCqPqVrCrP5yOwIuAqL$24.SpWqTrUwJxWxS2xPtCrPpW$25.XqVuGwHwEwCwEtK$25.rFtNtStTtStOsT$25.pLpRpHL!" },
];

export function entpacke(text) {
  const zeilen = [[]];
  for (const [, anzahl, zeichen] of text.replace(/!$/, "").matchAll(/(\d*)([$.]|[p-y]?[A-X])/g)) {
    const n = anzahl ? Number(anzahl) : 1;
    if (zeichen === "$") {
      for (let i = 0; i < n; i++) zeilen.push([]);
      continue;
    }
    let wert = 0;
    if (zeichen.length === 1 && zeichen !== ".") wert = zeichen.charCodeAt(0) - 64;
    if (zeichen.length === 2) wert = (zeichen.charCodeAt(0) - 112) * 24 + zeichen.charCodeAt(1) - 64 + 24;
    for (let i = 0; i < n; i++) zeilen.at(-1).push(wert / 255);
  }
  const breite = Math.max(...zeilen.map((z) => z.length));
  return { breite, hoehe: zeilen.length, wert: (x, y) => zeilen[y][x] ?? 0 };
}
